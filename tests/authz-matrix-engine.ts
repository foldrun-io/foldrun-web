// Calls one route method as one caller, in-process: the proxy first (the
// cross-site, path, body and rate rules that sit in front of every handler),
// then the real handler. Used by authz-matrix.test.ts.

import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";
import { A, DATA, DB, IDS, reSignIn, type Who } from "./authz-matrix-fixture.ts";

export const API = path.join(import.meta.dirname, "..", "app", "v1");
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The values a route's dynamic segments take when the request is aimed at account A's things. */
export const PARAM_A: Record<string, string> = {
  workspace: A.ws, tenant: A.tenant, runId: A.run, flow: A.flow, agent: A.agent, evalName: A.eval, tool: "fetcher",
  callId: "c1", kind: "agents", id: "x", customer: "cust-1", context: "code-matrix",
};

export const fileOf = (apiPath: string) => path.join(API, apiPath.replace(/^\/v1\//, "").replace(/\{(\w+)\}/g, "[$1]"), "route.ts");

export function fill(apiPath: string, params: Record<string, string>): string {
  return apiPath.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? `none-${k}`));
}

async function readSome(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + 1200;
  try {
    while (size < 400_000 && Date.now() < deadline) {
      const next = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
      if (next.done || !next.value) break;
      chunks.push(next.value);
      size += next.value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface Result { status: number; body: string; headers: Record<string, string>; threw: boolean; url: string }

export interface CallSpec {
  method: string;
  path: string; // /v1/… with {params}
  params: Record<string, string>;
  who: Who;
  query?: string;
  body?: unknown;
  extraHeaders?: Record<string, string>;
}

const mods = new Map<string, Record<string, Handler>>();
async function handlerFor(apiPath: string, method: string): Promise<Handler | null> {
  const f = fileOf(apiPath);
  if (!fs.existsSync(f)) return null;
  let m = mods.get(f);
  if (!m) { m = (await import(f)) as Record<string, Handler>; mods.set(f, m); }
  return m[method] ?? null;
}

export async function call(spec: CallSpec): Promise<Result | null> {
  const handler = await handlerFor(spec.path, spec.method);
  if (!handler) return null;
  const url = `http://localhost${fill(spec.path, spec.params)}${spec.query ? `?${spec.query}` : ""}`;
  const isWrite = spec.method !== "GET" && spec.method !== "HEAD";
  const payload = JSON.stringify(spec.body ?? {});
  const mk = () =>
    new NextRequest(url, {
      method: spec.method,
      headers: { "content-type": "application/json", ...spec.who.headers, ...spec.extraHeaders, ...(isWrite ? { "content-length": String(Buffer.byteLength(payload)) } : {}) },
      ...(isWrite ? { body: payload } : {}),
    });
  const pack = async (res: Response, threw = false): Promise<Result> => {
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, body: await readSome(res), headers, threw, url };
  };
  const gate = await proxy(mk());
  const passed = gate.headers.get("x-middleware-next") === "1" || gate.headers.has("x-middleware-rewrite");
  if (!passed) return pack(gate);
  try {
    return await pack(await handler(mk(), { params: Promise.resolve({ ...spec.params }) }));
  } catch (err) {
    // A throw that escapes a handler is Next's 500; what it says is only logged. Count it as one, with its text for the scan.
    return { status: 500, body: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err), headers: {}, threw: true, url };
  }
}

// ---- A's state, to prove a refused write wrote nothing -------------------------
import crypto from "node:crypto";
const NOISE = /(^|\/)(audit|ops|\.locks?)(\/|\.|$)|hook-deliveries|\.lock$|runs\/\.index\.json$/;
export function snapshotA(parts?: Map<string, string>): string {
  const h = crypto.createHash("sha256");
  const note = (k: string, v: string) => { h.update(`${k}:${v}`); parts?.set(k, v); };
  const walk = (dir: string, rel: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (NOISE.test(r)) continue;
      if (e.isDirectory()) walk(p, r);
      else if (e.isSymbolicLink()) note(r, "->link");
      else note(r, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  walk(path.join(DATA, A.tenant), "A");
  // The install-wide stores that hold A's keys and people, minus what a request is allowed to touch (last use, sessions).
  for (const f of ["keys.json", "users.json", "shares.json"]) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>[];
      const mine = rows.filter((r) => JSON.stringify(r).includes(A.tenant)).map((r) => ({ ...r, lastUsedAt: null, lastIp: null, lastSeenAt: null, sessions: null }));
      note(f, JSON.stringify(mine));
    } catch {
      note(f, "unreadable");
    }
  }
  return h.digest("hex");
}

export function pristine(): void {
  if (DB) return; // the database is not copied: the matrix does not let A's own writes through there
  fs.cpSync(DATA, `${DATA}.pristine`, { recursive: true });
}
export function restore(): void | Promise<void> {
  if (DB) return reSignIn();
  for (const e of fs.readdirSync(DATA)) fs.rmSync(path.join(DATA, e), { recursive: true, force: true });
  fs.cpSync(`${DATA}.pristine`, DATA, { recursive: true });
}
export { IDS, DB };

/** Which parts of A's state differ between two snapshots, for a failure message. */
export function whatChanged(a: Map<string, string>, b: Map<string, string>): string {
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).slice(0, 4).join(", ");
}
