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
// where there is nobody else to race with.
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
import { cache } from "@/platform/cache";
import { resolveTenant } from "./auth.ts";
import { installKey } from "@/lib/webhook.ts";

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

async function claim(id: string, value: Stored): Promise<Stored | null> {
  const c = cache();
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
    } catch {
      // fall through to memory
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
  const c = cache();
  if (c) {
    try {
      await c.expire(`idemr:${id}`, PENDING_TTL_SEC);
      return;
    } catch {}
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
  const c = cache();
  if (c) {
    try {
      await c.set(`idemr:${id}`, JSON.stringify(value), "EX", IDEMPOTENCY_TTL_SEC);
      return;
    } catch {}
  }
  memory.set(id, { v: value, until: Date.now() + IDEMPOTENCY_TTL_SEC * 1000 });
}

async function release(id: string): Promise<void> {
  memory.delete(id);
  const c = cache();
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

/**
 * Run `handler` at most once per Idempotency-Key. With no key it simply runs.
 *
 *   export async function POST(req, ctx) { return idempotent(req, () => post(req, ctx)); }
 */
export async function idempotent(req: NextRequest, handler: () => Promise<Response>, opts: IdempotentOptions = {}): Promise<Response> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return handler();
  if (key.length > KEY_MAX) {
    return NextResponse.json({ error: `Idempotency-Key is at most ${KEY_MAX} characters` }, { status: 400 });
  }
  // Unauthenticated: let the route say so; nothing to remember against.
  const auth = await resolveTenant(req);
  if (auth.tenant === null) return handler();

  const bytes = new Uint8Array(await req.clone().arrayBuffer());
  const url = req.nextUrl;
  // Keyed, not a bare hash: the body of PUT /api/secrets IS a secret, and a
  // plain sha256 of it in Redis for a day is a guessing target offline.
  const fp = sha(`${req.method} ${url.pathname}${url.search}\n`) + crypto.createHmac("sha256", installKey()).update(bytes).digest("hex");
  const id = sha(`${auth.tenant}\n${auth.actor.kind}:${auth.actor.id}\n${req.method} ${url.pathname}\n${key}`).slice(0, 40);

  const prior = await claim(id, { fp, state: "pending" });
  if (prior) {
    if (prior.fp !== fp) {
      return NextResponse.json(
        { error: "this Idempotency-Key was already used with a different request body — use a new key for a new request" },
        { status: 422 },
      );
    }
    if (prior.state === "pending") {
      return NextResponse.json(
        { error: "a request with this Idempotency-Key is still being answered — retry in a moment", retry_after: 1 },
        { status: 409, headers: { "retry-after": "1" } },
      );
    }
    return new NextResponse(prior.body ?? "", {
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
