// Idempotency-Key on the POSTs that do something — start a run, deploy, mint
// a key, charge a card. A client that lost the response retries with the same
// key and gets the first answer back instead of a second run.
//
//   same key, same body, within 24h  → the original status and body, with
//                                      `Idempotent-Replayed: true`
//   same key, different body         → 422
//   same key while the first is still being answered → 409, retry shortly
//
// Keys are per caller — the account AND the credential, a person or a key —
// and per route (the same key on a deploy and a run are two requests). The
// stored answer is replayed before the route checks permission, so a key
// shared across credentials once handed one member's answer (a minted key's
// secret included) to another member, a viewer's key too. A 5xx is not
// remembered — the server failed, a retry deserves a real second attempt —
// and neither is a streamed answer (?wait with an event stream).
//
// Stored where flow-run's own key lives (platform trigger-gate.ts): the
// platform cache, `SET NX` with a 24-hour expiry, so every web pod sees the
// same claim. Without Redis it is this process's memory — the one-pod case,
// where there is nobody else to race with. With Redis configured but not
// answering, a keyed request is a 503 to retry, never a claim in memory that
// the other pods cannot see (17 Nov 2026).
//
// The claim made while a request is being answered lasts PENDING_TTL_SEC
// and is kept alive while the handler runs (a ?wait run may take 15
// minutes); only the finished answer is kept for 24 hours. A pod that dies
// mid-request therefore blocks the key for two minutes, not a day.
//
// A route that answers with a secret (a key mint or rotate) names it in
// `secretFields`: the secret is answered once and stored as null, so a
// replay says what was done without repeating — or keeping — the secret.

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cacheClient } from "@/platform/cache";
import { opsLog } from "@/lib/ops-log.ts";
import { resolveTenant } from "./auth.ts";
import { installKey } from "@/lib/webhook.ts";
import { refuseWith } from "./api.ts";
import { currentErrorShape, errorBody, legacyErrorBody } from "./error-shape.ts";

/** A stored refusal in the shape THIS request is answered in: the first
 *  answer may have been made under another version or as a browser (one
 *  claim spans them, so a write never runs twice). Anything that is not a
 *  JSON refusal is replayed byte for byte (Codex review, 22 Nov 2026). */
export function replayedBody(body: string, status: number, type: string | undefined): string {
  if (status < 400 || !(type ?? "application/json").includes("json")) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const o = parsed as { type?: unknown; error?: unknown } | null;
  if (!o || typeof o !== "object") return body;
  const anthropic = o.type === "error" && Boolean(o.error) && typeof o.error === "object";
  // A deploy's 422 stored before 22 Nov had no sentence, only `reason`.
  const reasonOnly = o.error === undefined && (o as { ok?: unknown }).ok === false && typeof (o as { reason?: unknown }).reason === "string";
  if (reasonOnly && currentErrorShape() === "anthropic") return JSON.stringify(errorBody(String((o as { reason: string }).reason), status, o as Record<string, unknown>, "anthropic"));
  const legacy = typeof o.error === "string";
  const want = currentErrorShape();
  if (anthropic && want === "legacy") return JSON.stringify(legacyErrorBody(o));
  if (legacy && want === "anthropic") {
    const { error, ...rest } = o as Record<string, unknown>;
    return JSON.stringify(errorBody(String(error), status, rest, "anthropic"));
  }
  return body;
}

export const IDEMPOTENCY_TTL_SEC = 24 * 3600;
/** Set by a handler whose answer must not be replayed; never sent out. */
export const NO_REPLAY_HEADER = "x-foldrun-no-replay";
/** How long an in-flight claim outlives its last heartbeat. */
export const PENDING_TTL_SEC = 120;
const HEARTBEAT_MS = 30_000;
/** Responses bigger than this are answered but not remembered. */
const MAX_STORED = 1_000_000;
const KEY_MAX = 255;
/** SET NX attempts before a key that keeps lapsing is answered 409. */
const CLAIM_TRIES = 3;

interface Stored {
  fp: string;
  state: "pending" | "done";
  status?: number;
  body?: string;
  type?: string;
}

const memory = new Map<string, { v: Stored; until: number }>();

/** A Redis that is configured but did not answer. A claim then is not made
 *  at all (claim answers "unavailable", the caller a 503): this pod's memory
 *  is invisible to the pod a retry lands on, so a claim kept there could run
 *  the request twice (17 Nov 2026). Logged, never silent. */
function cacheMissed(op: string, err: unknown): void {
  opsLog("warn", "idempotency.cache_unavailable", { op, error: err instanceof Error ? err.message : String(err) });
}

async function claim(id: string, value: Stored): Promise<Stored | null | "unavailable"> {
  // cacheClient, not cache(): the client queues nothing while it connects,
  // so the first claim on a pod that has just started failed and fell to
  // this pod's memory — invisible to the pod a retry lands on.
  const c = await cacheClient();
  if (c) {
    try {
      // SET NX then GET is two calls: the winner's claim can lapse or be
      // released between them, and the GET finds nothing. Never go on
      // unclaimed — a third retry would then claim the free key and run
      // alongside this one. Try to claim again; if the key keeps flickering,
      // answer as if the original were still outstanding (409, retry).
      for (let i = 0; i < CLAIM_TRIES; i++) {
        const ok = await c.set(`idemr:${id}`, JSON.stringify(value), "EX", PENDING_TTL_SEC, "NX");
        if (ok === "OK") return null;
        const raw = await c.get(`idemr:${id}`);
        if (raw) return JSON.parse(raw) as Stored;
      }
      return { fp: value.fp, state: "pending" };
    } catch (err) {
      cacheMissed("claim", err);
      return "unavailable";
    }
  }
  const now = Date.now();
  const hit = memory.get(id);
  if (hit && hit.until > now) return hit.v;
  if (memory.size > 10_000) for (const [k, v] of memory) if (v.until <= now) memory.delete(k);
  memory.set(id, { v: value, until: now + PENDING_TTL_SEC * 1000 });
  return null;
}

/** Keep an in-flight claim alive while its handler still runs. */
async function touch(id: string): Promise<void> {
  const c = await cacheClient();
  if (c) {
    try {
      await c.expire(`idemr:${id}`, PENDING_TTL_SEC);
      return;
    } catch (err) {
      cacheMissed("touch", err);
    }
  }
  const hit = memory.get(id);
  if (hit && hit.v.state === "pending") hit.until = Date.now() + PENDING_TTL_SEC * 1000;
}

function withoutSecrets(body: string, fields: string[] | undefined): string {
  if (!fields?.length) return body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
    const o = parsed as Record<string, unknown>;
    for (const f of fields) if (f in o) o[f] = null;
    return JSON.stringify(o);
  } catch {
    return body;
  }
}

export interface IdempotentOptions {
  /** Top-level JSON fields answered once and stored as null — a secret. */
  secretFields?: string[];
}

async function store(id: string, value: Stored): Promise<void> {
  const c = await cacheClient();
  if (c) {
    try {
      await c.set(`idemr:${id}`, JSON.stringify(value), "EX", IDEMPOTENCY_TTL_SEC);
      return;
    } catch (err) {
      cacheMissed("store", err);
    }
  }
  memory.set(id, { v: value, until: Date.now() + IDEMPOTENCY_TTL_SEC * 1000 });
}

async function release(id: string): Promise<void> {
  memory.delete(id);
  const c = await cacheClient();
  if (c) {
    try {
      await c.del(`idemr:${id}`);
    } catch {}
  }
}

/** For tests. */
export function resetIdempotencyMemory(): void {
  memory.clear();
}

const sha = (b: string | Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

/** Query parameters that say how long to wait for the answer, not what is
 *  asked — on the routes that start a run (`…/run`, `…/rerun`, server/wait.ts)
 *  and only there: a start retried without `?wait` (or with another timeout)
 *  is the same request and gets the first answer back (17 Nov 2026: it was a
 *  422, "a different request body"). The replay is that first answer as it
 *  was — a 202 stays a 202 — and carries the run's id to read or wait on. */
const HOW_TO_ANSWER = new Set(["wait", "timeout"]);
const STARTS_A_RUN = /\/(run|rerun)$/;

/** The query as it counts toward the fingerprint. */
export function requestQuery(url: URL): string {
  if (!STARTS_A_RUN.test(url.pathname)) return url.search;
  const kept = [...url.searchParams].filter(([k]) => !HOW_TO_ANSWER.has(k));
  return kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
}

/**
 * Run `handler` at most once per Idempotency-Key. With no key it simply runs.
 *
 *   export async function POST(req, ctx) { return idempotent(req, () => post(req, ctx)); }
 */
export async function idempotent(req: NextRequest, handler: () => Promise<Response>, opts: IdempotentOptions = {}): Promise<Response> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return handler();
  if (key.length > KEY_MAX) {
    return refuseWith(`Idempotency-Key is at most ${KEY_MAX} characters`, 400);
  }
  // Unauthenticated: let the route say so; nothing to remember against.
  const auth = await resolveTenant(req);
  if (auth.tenant === null) return handler();

  const bytes = new Uint8Array(await req.clone().arrayBuffer());
  const url = req.nextUrl;
  // Keyed, not a bare hash: the body of PUT /v1/secrets IS a secret, and a
  // plain sha256 of it in Redis for a day is a guessing target offline.
  const fp = sha(`${req.method} ${url.pathname}${requestQuery(url)}\n`) + crypto.createHmac("sha256", installKey()).update(bytes).digest("hex");
  const id = sha(`${auth.tenant}\n${auth.actor.kind}:${auth.actor.id}\n${req.method} ${url.pathname}\n${key}`).slice(0, 40);

  const prior = await claim(id, { fp, state: "pending" });
  if (prior === "unavailable") {
    // The caller asked for at most once, and this pod cannot promise it.
    return refuseWith("this request carries an Idempotency-Key, and the store that keeps it is not answering — retry in a moment", 503, { retry_after: 2 }, { headers: { "retry-after": "2" } });
  }
  if (prior) {
    if (prior.fp !== fp) {
      return refuseWith("this Idempotency-Key was already used with a different request body — use a new key for a new request", 422);
    }
    if (prior.state === "pending") {
      return refuseWith("a request with this Idempotency-Key is still being answered — retry in a moment", 409, { retry_after: 1 }, { headers: { "retry-after": "1" } });
    }
    return new NextResponse(replayedBody(prior.body ?? "", prior.status ?? 200, prior.type), {
      status: prior.status ?? 200,
      headers: { "content-type": prior.type ?? "application/json", "idempotent-replayed": "true" },
    });
  }

  let res: Response;
  const beat = setInterval(() => void touch(id), HEARTBEAT_MS);
  beat.unref?.();
  try {
    res = await handler();
  } catch (err) {
    await release(id);
    throw err;
  } finally {
    clearInterval(beat);
  }
  const type = res.headers.get("content-type") ?? "";
  // A response whose meaning is in something a replay cannot carry — a
  // browser-bound OAuth start sets its binding cookie (server/oauth-browser.ts)
  // — is not kept: a retry with the same key runs again, which is safe.
  if (res.status >= 500 || type.includes("text/event-stream") || res.headers.get(NO_REPLAY_HEADER)) {
    res.headers.delete(NO_REPLAY_HEADER);
    await release(id);
    return res;
  }
  try {
    const body = withoutSecrets(await res.clone().text(), opts.secretFields);
    if (body.length > MAX_STORED) await release(id);
    else await store(id, { fp, state: "done", status: res.status, body, type: type || "application/json" });
  } catch {
    await release(id);
  }
  return res;
}
