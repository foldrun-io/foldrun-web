// The authorization matrix. Every API route and method, called as every kind
// of caller — nobody; a viewer, editor, admin and owner of account A, by key
// and by session; a key and a session limited to one workspace; a stranger's
// account B (owner session, admin key) that has a workspace of the SAME name;
// and the operator's own account — through the real proxy and the real
// handlers, against account A's seeded data (authz-matrix-fixture.ts). The
// expected status of each cell comes from the design, in authz-matrix-table.ts.
//
// Beside the status, every response is searched for what must never be there:
// A's secret values and keys for anyone; A's content, names and emails for
// anyone outside A; anything outside its one workspace for a limited caller.
// A refused or foreign write must leave A's files, keys and people unchanged.
// The route list is checked both ways: a route with no row fails.
//
//   node --import ./tests/register.mjs --experimental-test-module-mocks --test tests/authz-matrix.test.ts
//
// Three ways to run it, the first being `npm test`:
//   files (default)   every write somebody is let to make really happens, and A is put back after.
//   FOLDRUN_TEST_DATABASE_URL=postgres://… (and FOLDRUN_TEST_REDIS_URL, never FOLDRUN_REDIS_URL)
//                     people, keys, sessions and shares in Postgres; only reads and refusals run, nothing can be put back.
//   FOLDRUN_EDITION=hosted, with `bash foldrun-admin/overlay.sh <root>` laid over the siblings
//                     the hosted routes too (OVERLAY_ROWS: wallet, plans, card, partner top-ups, support view).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { A, B, WHO, NEVER_SHOWN, A_ONLY, NOT_SIDE, KEYS, IDS, TOKENS, SHARE, type Who } from "./authz-matrix-fixture.ts";
import { call, fileOf, PARAM_A, API, pristine, restore, snapshotA, whatChanged, DB, type Result } from "./authz-matrix-engine.ts";
import { TABLE as PUBLIC_TABLE, OVERLAY_ROWS, REAL_WRITES, WRITE_OK, OVERLAY_ONLY, IN_FLUX, KNOWN_GAPS, type Row, type Extras } from "./authz-matrix-table.ts";
import { ROUTES } from "../server/openapi-routes.ts";
import { NextRequest } from "next/server";
import { shareId } from "../../foldrun-platform/src/shares.ts";
import { unzip } from "../../foldrun-core/src/zip.ts";
import { webhookToken, approveToken, eventToken } from "../../foldrun-core/src/webhook.ts";

/** The hosted edition, with the private overlay laid over this tree (see OVERLAY_ROWS). */
const HOSTED = process.env.FOLDRUN_EDITION === "hosted";
const TABLE: Row[] = [...PUBLIC_TABLE, ...OVERLAY_ROWS.filter(([, p]) => fs.existsSync(fileOf(p)))];
const RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const;
type Expect = { kind: "deny"; statuses: number[]; why: string } | { kind: "pass" };

interface Spec { min: keyof typeof RANK; words: Set<string> }
const specOf = (s: string): Spec => {
  const words = new Set(s.split(/\s+/));
  const min = (["owner", "admin", "editor", "viewer"] as const).find((r) => words.has(r)) ?? "viewer";
  return { min, words };
};

/** What the design says this caller gets from this route. */
function expected(row: Row, who: Who): Expect {
  const [method, p, spec, extras = {}] = row;
  const { min, words } = specOf(spec);
  if (words.has("gone")) return { kind: "deny", statuses: [410], why: "gone" };
  if (words.has("hosted") && !HOSTED) return { kind: "deny", statuses: [404], why: "hosted only" };
  // 501: the hosted routes that need the platform's database say so on a file store (this suite's).
  if (words.has("token")) return { kind: "deny", statuses: [...(extras.ok ?? [401, 403, 404]), ...(words.has("hosted") ? [501] : [])], why: "needs the link's token" };
  if (words.has("none")) return { kind: "pass" };
  if (who.via === "none") return { kind: "deny", statuses: [extras.anon ?? 401], why: "no credential" };
  if (words.has("keyOnly") && who.via === "session") return { kind: "deny", statuses: [401], why: "keys only" };
  if ((words.has("session")) && who.via === "key") return { kind: "deny", statuses: [401], why: "session only" };
  if (words.has("ownerOnly") && who.via === "key") return { kind: "deny", statuses: [401], why: "session only" };
  if (p.startsWith("/v1/workspaces/{workspace}") && who.scope && !who.scope.includes(A.ws)) return { kind: "deny", statuses: [403], why: "workspace out of scope" };
  if (RANK[who.role!] < RANK[min]) return { kind: "deny", statuses: [403], why: `needs ${min}` };
  if (words.has("person") && who.via === "key") return { kind: "deny", statuses: [401], why: "a person, not a key" };
  if (words.has("wide") && who.scope) return { kind: "deny", statuses: [403], why: "account-wide" };
  void method;
  return { kind: "pass" };
}

const okFor = (row: Row, who: Who): number[] => {
  const ex: Extras = row[3] ?? {};
  const base = [...(ex.ok ?? (row[0] === "GET" ? [200] : WRITE_OK)), ...(row[2].includes("hosted") ? [501] : [])];
  // A caller of another account runs against ITS OWN data: a name A has, B does not, so a 404 is the answer there.
  return who.account === "A" ? base : [...new Set([...base, ...WRITE_OK, 200, 403, 404])];
};

const FLAT = (s: string) => s.replace(/\s+/g, " ");
function request(row: Row, who: Who, over: Partial<{ params: Record<string, string>; extraHeaders: Record<string, string>; query: string; body: unknown }> = {}) {
  const ex: Extras = row[3] ?? {};
  return {
    method: row[0],
    path: row[1],
    params: { ...PARAM_A, ...ex.params, ...over.params },
    who,
    query: over.query ?? ex.q,
    body: over.body ?? ex.body,
    extraHeaders: over.extraHeaders,
  };
}

const failures: string[] = [];
const seenGaps = new Set<string>();
const fail = (m: string) => {
  const gap = Object.keys(KNOWN_GAPS).find((k) => m.startsWith(`${k}:`));
  if (gap) seenGaps.add(gap);
  else failures.push(m);
};
let cells = 0;
const callerCounts: Record<string, number> = {};
pristine();

/** Strings the request itself carries are not a leak when the answer repeats them. */
const requestText = (res: Result, body: unknown) => `${res.url} ${JSON.stringify(body ?? "")}`;

function scan(row: Row, who: Who, res: Result, body: unknown) {
  const where = `${row[0]} ${row[1]} as ${who.label}`;
  const text = `${res.body}\n${JSON.stringify(res.headers)}`;
  const req = requestText(res, body);
  if (/"(hash|salt|passwordHash|mfaSecret|totpSecret|backupCodes)"\s*:/.test(res.body)) fail(`${where}: a credential's hash, salt or second-factor secret is in the answer`);
  for (const s of NEVER_SHOWN) if (text.includes(s) && !req.includes(s)) fail(`${where}: a secret came back (${s.slice(0, 22)}…)`);
  if (who.account !== "A") for (const s of A_ONLY) if (text.includes(s) && !req.includes(s)) fail(`${where}: account A's data came back (${s.slice(0, 26)}…)`);
  // A link whose possession is the permission is shown only to those the design lets use it: a hook's URL to an admin, a parked run's release and approval links to an editor.
  for (const [name, need] of [["hook", "admin"], ["event", "editor"], ["approve", "editor"]] as const) {
    const token = TOKENS[name];
    const may = who.account === "A" && who.role !== null && RANK[who.role] >= RANK[need] && who.via !== "none";
    if (!may && (text.includes(token) || res.body.includes(encodeURIComponent(token)))) fail(`${where}: the ${name} link's token came back to a caller below ${need}`);
  }
  if (who.account !== "B") for (const s of [B.content, B.emailDomain]) if (text.includes(s) && !req.includes(s)) fail(`${where}: account B's data came back (${s.slice(0, 26)}…)`);
  if (who.account === "A" && who.scope && (res.body.trim().startsWith("{") || res.body.trim().startsWith("["))) {
    // A caller limited to `side` is not even told the OTHER workspaces' names: they are exact strings or keys in the answer, not words in prose.
    const names = new Set<string>();
    try { (function walk(v: unknown) { if (typeof v === "string") names.add(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { names.add(k); walk(x); } })(JSON.parse(res.body)); } catch { /* not JSON */ }
    if (who.account === "A" && who.scope) for (const w of [A.ws, A.vault]) if (names.has(w) && !req.includes(w)) fail(`${where}: a workspace the caller was not given (${w}) is named in the answer`);
  }
  if (who.account === "A" && who.scope) for (const s of NOT_SIDE) if (text.includes(s) && !req.includes(s)) fail(`${where}: data outside the caller's workspace came back (${s.slice(0, 26)}…)`);
  if (res.status < 500 && /\bpublic\b|s-maxage/i.test(res.headers["cache-control"] ?? "") && who.via !== "none" && !specOf(row[2]).words.has("none")) fail(`${where}: an answer for a signed-in caller may be cached by anyone (${res.headers["cache-control"]})`);
}

test("every route in the generated list and in app/v1 has a row, and every row is a route", () => {
  const rows = new Set(TABLE.map(([m, p]) => `${m} ${p}`));
  const overlayHere = OVERLAY_ROWS.some(([, p]) => fs.existsSync(fileOf(p)));
  const listed = new Set<string>();
  for (const r of ROUTES) for (const m of r.methods) listed.add(`${m} ${r.path}`);
  const missing = [...listed].filter((k) => !rows.has(k) && (overlayHere || !OVERLAY_ONLY.test(k.split(" ")[1])) && !k.split(" ")[1].startsWith("/s/"));
  assert.deepEqual(missing, [], `routes with no row in authz-matrix-table.ts: ${missing.join(", ")}`);
  const stale = [...rows].filter((k) => !listed.has(k) && !k.includes("/v1/support/"));
  assert.deepEqual(stale, [], `rows for routes that are not in the route list: ${stale.join(", ")}`);
  // And from the files: a handler exported but not in the list (the list is generated, the files are the truth).
  const onDisk: string[] = [];
  (function find(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) find(p);
      else if (e.name === "route.ts") {
        const src = fs.readFileSync(p, "utf8");
        const rel = "/v1/" + p.slice(API.length + 1).replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, "{$1}");
        for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) if (new RegExp(`export (async )?function ${m}\\b|export const ${m}\\b`).test(src)) onDisk.push(`${m} ${rel}`);
      }
    }
  })(API);
  const unrowed = onDisk.filter((k) => !rows.has(k));
  assert.deepEqual(unrowed, [], `handlers on disk with no row: ${unrowed.join(", ")}`);
  for (const [, p] of TABLE) if (!fs.existsSync(fileOf(p))) assert.fail(`row ${p} has no route file`);
});

test("the matrix: every row, every caller — status, leaks, and what a refused write left behind", async () => {
  const callers = Object.values(WHO);
  for (const row of TABLE) {
    const key = `${row[0]} ${row[1]}`;
    const writes = row[0] !== "GET";
    for (const who of callers) {
      const want = expected(row, who);
      // With a database there is no putting anything back: the writes somebody is let to make are the file run's (and the handlers' own tests'); here only reads and refusals run.
      if (DB && writes && want.kind === "pass") continue;
      const before = writes ? snapshotA() : "";
      const spec = request(row, who);
      const res = await call(spec);
      if (!res) { fail(`${key}: no handler`); continue; }
      cells++;
      callerCounts[who.label] = (callerCounts[who.label] ?? 0) + 1;
      const where = `${key} as ${who.label}`;
      if (res.threw || res.status >= 500 && !okFor(row, who).includes(res.status)) fail(`${where}: a ${res.status} (${FLAT(res.body).slice(0, 160)})`);
      else if (!IN_FLUX.has(key)) {
        if (want.kind === "deny") {
          if (!want.statuses.includes(res.status)) fail(`${where}: expected ${want.statuses.join("/")} (${want.why}), got ${res.status} ${FLAT(res.body).slice(0, 120)}`);
        } else if (!okFor(row, who).includes(res.status)) {
          fail(`${where}: let in, expected ${okFor(row, who).join("/")}, got ${res.status} ${FLAT(res.body).slice(0, 120)}`);
        }
      }
      scan(row, who, res, spec.body);
      if (writes) {
        const letIn = want.kind === "pass" && who.account === "A";
        if (!letIn && snapshotA() !== before) fail(`${where}: answered ${res.status} and changed account A's state`);
        if (res.status < 300) await restore();
      }
    }
  }
  const stale = Object.keys(KNOWN_GAPS).filter((k) => !seenGaps.has(k));
  assert.deepEqual(stale, [], `known gaps that no longer happen — delete them from KNOWN_GAPS: ${stale.join(", ")}`);
  console.log(`# authz matrix: ${TABLE.length} routes x methods, ${callers.length} callers, ${cells} cells (${Object.entries(callerCounts).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  assert.ok(cells >= (DB ? 1500 : 2500), `only ${cells} cells ran`);
  if (process.env.MATRIX_REPORT) fs.writeFileSync(process.env.MATRIX_REPORT, failures.join("\n"));
  assert.deepEqual(failures.slice(0, 80), [], `${failures.length} wrong cells of ${cells}`);
});

// ---- the same question, asked about a thing that exists and a thing that does not ---------------
const norm = (text: string, values: string[]) => values.filter(Boolean).reduce((t, v) => t.split(v).join("<name>"), text).replace(/"?(at|t|ts|time|checkedAt|updatedAt|createdAt)"?:"[^"]*"/g, "");

test("a stranger asking for A's workspace or run is told exactly what it is told for a name nobody has", async () => {
  const askers = [WHO.strangerSession, WHO.strangerKey, WHO.operatorSession, WHO.scopedKey];
  let pairs = 0;
  const diffs: string[] = [];
  for (const row of TABLE) {
    if (!row[1].includes("{workspace}") || specOf(row[2]).words.has("token")) continue;
    for (const who of askers) {
      for (const [real, fake, params] of [
        // A workspace only A has, against one nobody has.
        [{ workspace: A.vault }, { workspace: "nowhere-at-all" }, [A.vault, "nowhere-at-all"]],
        // A run only A has, in a workspace the asker has too (B's own `desk`), against a run nobody has.
        [{ workspace: A.ws, runId: A.run }, { workspace: A.ws, runId: "run-nobody-1" }, [A.run, "run-nobody-1"]],
      ] as const) {
        if (!row[1].includes("{runId}") && "runId" in real) continue;
        if (who.scope && "runId" in real) continue; // the scoped key is refused the workspace before the run
        if (DB && row[0] !== "GET" && expected(row, who).kind === "pass") continue;
        const a = await call(request(row, who, { params: real }));
        const b = await call(request(row, who, { params: fake }));
        if (!a || !b) continue;
        pairs++;
        const same = a.status === b.status && norm(a.body, [...params]) === norm(b.body, [...params]);
        if (!same) diffs.push(`${row[0]} ${row[1]} as ${who.label}: ${a.status} ${FLAT(a.body).slice(0, 90)}  vs nobody's ${b.status} ${FLAT(b.body).slice(0, 90)}`);
        if (row[0] !== "GET" && (a.status < 300 || b.status < 300)) await restore();
      }
    }
  }
  assert.ok(pairs > (DB ? 150 : 300), `only ${pairs} pairs compared`);
  assert.deepEqual(diffs, [], `${diffs.length} routes say more about A's things than about a name nobody has`);
});

// ---- a caller's own claims about who it is are not read --------------------------------------
test("x-foldrun-tenant, forwarded headers, ?tenant=, a body's tenant and a method override change nothing", async () => {
  const spoof = {
    extraHeaders: {
      "x-foldrun-tenant": A.tenant, "x-tenant": A.tenant, "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost", "x-forwarded-proto": "https",
      "x-real-ip": "127.0.0.1", "x-original-url": `/v1/workspaces/${A.ws}`, "x-http-method-override": "DELETE", "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware",
    },
    query: `tenant=${A.tenant}&account=${A.tenant}&_method=DELETE`,
  };
  const diffs: string[] = [];
  let n = 0;
  for (const row of TABLE) {
    if (specOf(row[2]).words.has("token") || row[0] !== "GET" && !["strangerKey", "anon"].includes("x")) {
      if (row[0] !== "GET") continue;
    }
    for (const who of [WHO.anon, WHO.strangerKey, WHO.strangerSession, WHO.operatorSession, WHO.viewerKey, WHO.scopedKey]) {
      const plain = await call(request(row, who));
      const lied = await call(request(row, who, { ...spoof, query: [row[3]?.q, spoof.query].filter(Boolean).join("&") }));
      if (!plain || !lied) continue;
      n++;
      if (plain.status !== lied.status) diffs.push(`${row[0]} ${row[1]} as ${who.label}: ${plain.status} plain, ${lied.status} with the claims`);
      scan(row, who, lied, undefined);
    }
  }
  // The same lies in the body of every write a stranger may make: A's names must not turn the write onto A.
  const beforeParts = new Map<string, string>();
  const before = snapshotA(beforeParts);
  for (const row of TABLE) {
    if (row[0] === "GET" || specOf(row[2]).words.has("token")) continue;
    for (const who of [WHO.strangerKey, WHO.strangerSession, WHO.operatorSession, WHO.viewerKey, WHO.scopedKey]) {
      if (DB && expected(row, who).kind === "pass") continue; // a write somebody is let to make cannot be put back in a database
      const res = await call(request(row, who, { ...spoof, body: { tenant: A.tenant, account: A.tenant, workspace: A.ws, path: "AGENTS.md", content: "overwritten", id: IDS.keyAdmin, name: A.secretName } }));
      if (!res) continue;
      n++;
      scan(row, who, res, { tenant: A.tenant, workspace: A.ws, path: "AGENTS.md", id: IDS.keyAdmin, name: A.secretName });
      const afterParts = new Map<string, string>();
      if (snapshotA(afterParts) !== before && who.account !== "A") diffs.push(`${row[0]} ${row[1]} as ${who.label}: body claims changed account A (${whatChanged(beforeParts, afterParts)})`);
      if (res.status < 300) await restore();
    }
  }
  assert.ok(n > 500);
  assert.deepEqual(diffs, []);
});

// ---- real, destructive requests aimed at A's real things ---------------------------------------
test("a real write at A's own run, key, member, secret and share by anyone the design refuses leaves A untouched", async () => {
  const wrong: string[] = [];
  let n = 0;
  for (const row of REAL_WRITES) {
    for (const who of Object.values(WHO)) {
      const want = expected(row, who);
      if (DB && want.kind === "pass") continue;
      const before = snapshotA();
      const spec = request(row, who);
      const res = await call(spec);
      if (!res) { wrong.push(`${row[0]} ${row[1]}: no handler`); continue; }
      n++;
      const where = `${row[0]} ${row[1]} ${JSON.stringify(row[3]?.params ?? row[3]?.body ?? "").slice(0, 60)} as ${who.label}`;
      if (res.status >= 500) wrong.push(`${where}: a ${res.status} ${FLAT(res.body).slice(0, 120)}`);
      else if (want.kind === "deny" && !want.statuses.includes(res.status)) wrong.push(`${where}: expected ${want.statuses.join("/")} (${want.why}), got ${res.status} ${FLAT(res.body).slice(0, 120)}`);
      const letIn = want.kind === "pass" && who.account === "A";
      if (!letIn && snapshotA() !== before) wrong.push(`${where}: answered ${res.status} and changed account A`);
      if (!letIn && who.account !== "A" && res.status < 300 && !["strangerSession", "strangerKey", "operatorSession"].includes(who.label)) wrong.push(`${where}: a ${res.status} for a caller the design refuses`);
      const sink = failures.length;
      scan(row, who, res, spec.body);
      if (failures.length > sink) wrong.push(...failures.splice(sink));
      if (res.status < 300) await restore();
    }
  }
  assert.ok(n >= (DB ? 200 : 380), `only ${n} cells`);
  assert.deepEqual(wrong, []);
});

test("A is whole after all of it, and the matrix could have seen a leak (its canaries are really there for A's own callers)", async () => {
  const src = await call({ method: "GET", path: "/v1/workspaces/{workspace}/source", params: PARAM_A, who: WHO.viewerKey, query: "path=AGENTS.md" });
  assert.equal(src?.status, 200);
  assert.ok(src!.body.includes(A.content), "A's viewer reads A's file: the content canary is findable");
  const run = await call({ method: "GET", path: "/v1/workspaces/{workspace}/runs/{runId}", params: PARAM_A, who: WHO.viewerSession });
  assert.ok(run!.body.includes(A.runText), "the run canary is findable");
  const secrets = await call({ method: "GET", path: "/v1/secrets", params: PARAM_A, who: WHO.viewerKey });
  assert.ok(secrets!.body.includes(A.secretName) || secrets!.status === 200, "the vault lists");
  for (const k of KEYS) {
    const me = await call({ method: "GET", path: "/v1/me", params: PARAM_A, who: { ...WHO.anon, headers: { authorization: `Bearer ${k.secret}` } } });
    assert.equal(me?.status, 200, `key ${k.id} still works`);
  }
  const mine = await call({ method: "GET", path: "/v1/workspaces/{workspace}/source", params: PARAM_A, who: WHO.strangerKey, query: "path=AGENTS.md" });
  assert.ok(mine!.body.includes(B.content) && !mine!.body.includes(A.content), "B's same-named workspace is B's own");
});

// ---- links whose token is the credential ----------------------------------------------------------
test("a link's token opens exactly its own tenant, workspace and flow or run — A's token under B's names, or the reverse, opens nothing", async () => {
  const hook = (tenant: string, workspace: string, flow: string, token: string) =>
    call({ method: "POST", path: "/v1/hooks/{tenant}/{workspace}/{flow}", params: { tenant, workspace, flow }, who: WHO.anon, query: `token=${token}`, body: { x: 1 } });
  const inbox = (tenant: string, workspace: string, flow: string, token: string) =>
    call({ method: "POST", path: "/v1/inbox/{tenant}/{workspace}/{flow}", params: { tenant, workspace, flow }, who: WHO.anon, query: `token=${token}`, body: { x: 1 } });
  const approve = (method: "GET" | "POST", tenant: string, workspace: string, runId: string, token: string) =>
    call({ method, path: "/v1/approve/{tenant}/{workspace}/{runId}", params: { tenant, workspace, runId }, who: WHO.anon, query: `token=${token}`, body: { decision: "approve" } });
  const event = (tenant: string, workspace: string, runId: string, token: string) =>
    call({ method: "POST", path: "/v1/events/{tenant}/{workspace}/{runId}", params: { tenant, workspace, runId }, who: WHO.anon, query: `token=${token}&step=0`, body: "paid" });
  const refused = [400, 401, 403, 404, 429];
  const wrong: string[] = [];
  let last = snapshotA();
  const must = async (what: string, r: Result | null, ok: number[]) => {
    await new Promise((x) => setTimeout(x, 20));
    if (!r || !ok.includes(r.status)) wrong.push(`${what}: ${r?.status} ${FLAT(r?.body ?? "").slice(0, 100)}`);
    const now = snapshotA();
    if (now !== last && !what.includes("right names")) wrong.push(`${what}: changed account A's files`);
    last = now;
  };
  const hookTok = webhookToken(A.tenant, A.ws, A.flow);
  await new Promise((r) => setTimeout(r, 400)); // what an earlier test left in flight lands first
  const beforeParts = new Map<string, string>();
  const before = snapshotA(beforeParts);
  // The right token on the right names is the one thing that works (the control: without it every refusal below proves nothing).
  if (!DB) {
    await must("hook, right names", await hook(A.tenant, A.ws, A.flow, hookTok), [200, 202]);
    await restore();
    last = snapshotA();
  }
  for (const [t, w, f] of [[B.tenant, A.ws, A.flow], [A.tenant, A.side, A.flow], [A.tenant, A.ws, "other-flow"], [A.tenant, A.vault, A.flow], [A.tenant.toUpperCase(), A.ws, A.flow]] as const) {
    await must(`hook under ${t}/${w}/${f}`, await hook(t, w, f, hookTok), refused);
    await must(`inbox under ${t}/${w}/${f}`, await inbox(t, w, f, hookTok), refused);
  }
  // The approve and event families are not the hook's: a hook token approves and releases nothing, nor the reverse.
  await must("hook token as approve", await approve("POST", A.tenant, A.ws, A.run, hookTok), refused);
  await must("hook token as event", await event(A.tenant, A.ws, A.run, hookTok), refused);
  await must("approve token as event", await event(A.tenant, A.ws, A.run, approveToken(A.tenant, A.ws, A.run)), refused);
  await must("event token as approve", await approve("POST", A.tenant, A.ws, A.run, eventToken(A.tenant, A.ws, A.run)), refused);
  await must("approve token as hook", await hook(A.tenant, A.ws, A.flow, approveToken(A.tenant, A.ws, A.flow)), refused);
  // A run's own token under another account, workspace or run.
  const ap = approveToken(A.tenant, A.ws, A.run);
  for (const [t, w, r] of [[B.tenant, A.ws, A.run], [A.tenant, A.side, A.run], [A.tenant, A.ws, `run-side-x`]] as const) {
    await must(`approve under ${t}/${w}/${r}`, await approve("GET", t, w, r, ap), refused);
    await must(`approve POST under ${t}/${w}/${r}`, await approve("POST", t, w, r, ap), refused);
    await must(`event under ${t}/${w}/${r}`, await event(t, w, r, TOKENS.event), refused);
  }
  await must("no token at all", await approve("POST", A.tenant, A.ws, A.run, ""), refused);
  const afterParts = new Map<string, string>();
  assert.equal(snapshotA(afterParts), before, `nothing of A's changed (${whatChanged(beforeParts, afterParts)})`);
  assert.deepEqual(wrong, []);
});

// ---- a public share link -------------------------------------------------------------------------
test("a share link opens its one file for anyone and nothing else; a revoke by B does nothing; only an admin or the link's maker sees its token", async () => {
  const share = await import("../app/s/[token]/route.ts");
  const open = (t: string) => share.GET(new NextRequest(`http://localhost/s/${encodeURIComponent(t)}`), { params: Promise.resolve({ token: t }) });
  const live = await open(SHARE.token);
  assert.equal(live.status, 200);
  assert.ok((await live.text()).includes(A.content), "the shared file is served");
  const missing = await open("not-a-token-" + "x".repeat(24));
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "Not found");
  // B (its own `desk`, admin key and owner session) and the operator cannot revoke A's link — by token, by id, under any workspace name.
  for (const who of [WHO.strangerKey, WHO.strangerSession, WHO.operatorSession, WHO.viewerKey, WHO.scopedKey, WHO.anon]) {
    for (const body of [{ token: SHARE.token }, { id: shareId(SHARE.token), token: SHARE.token }]) {
      await call({ method: "DELETE", path: "/v1/workspaces/{workspace}/shares", params: PARAM_A, who, body, query: `token=${SHARE.token}` });
    }
  }
  assert.equal((await open(SHARE.token)).status, 200, "the link still opens after those");
  // The list: the maker sees the token and its URL, everyone else a masked one.
  const seen = async (who: Who) => (await call({ method: "GET", path: "/v1/workspaces/{workspace}/shares", params: PARAM_A, who }))!.body;
  for (const who of [WHO.ownerSession, WHO.adminKey, WHO.adminSession]) assert.ok((await seen(who)).includes(SHARE.token), `${who.label} sees the link`);
  for (const who of [WHO.viewerKey, WHO.viewerSession, WHO.editorKey, WHO.editorSession]) assert.ok(!(await seen(who)).includes(SHARE.token), `${who.label} sees a masked token`);
  for (const who of [WHO.strangerKey, WHO.anon, WHO.scopedKey]) assert.ok(!(await seen(who)).includes(SHARE.token));
  // A path outside the shareable folders is not shareable by anyone.
  for (const who of [WHO.ownerSession, WHO.adminKey]) {
    for (const p of ["AGENTS.md", "memory/learned.md", "../desk/AGENTS.md", "agents/writer/agent.md", "runs/x.json"]) {
      const r = await call({ method: "POST", path: "/v1/workspaces/{workspace}/shares", params: PARAM_A, who, body: { path: p } });
      assert.ok(r!.status >= 400 && r!.status < 500, `${who.label} shares ${p}: ${r!.status}`);
    }
  }
  await restore();
});

// ---- what leaves the account in a file ------------------------------------------------------------
test("the workspace export a viewer may take, and the account export an owner may, carry no secret value, token or key", async () => {
  const ws = await (async () => {
    const res = await (await import("../app/v1/workspaces/[workspace]/export/route.ts") as { GET: (r: NextRequest, c: { params: Promise<{ workspace: string }> }) => Promise<Response> })
      .GET(new NextRequest(`http://localhost/v1/workspaces/${A.ws}/export`, { headers: WHO.viewerKey.headers }), { params: Promise.resolve({ workspace: A.ws }) });
    assert.equal(res.status, 200);
    return unzip(Buffer.from(await res.arrayBuffer()));
  })();
  const all = ws.map((e) => `${e.path}\n${Buffer.from(e.data).toString("utf8")}`).join("\n");
  assert.ok(all.includes(A.content), "the export has the workspace's files");
  for (const s of [...NEVER_SHOWN, ...Object.values(TOKENS)]) assert.ok(!all.includes(s), `the export holds ${s.slice(0, 18)}…`);
  assert.deepEqual(ws.map((e) => e.path).filter((p) => /^(runs|\.|secrets|hooks\.json|state\/keys)/.test(p) || /secret|\.env|credential/i.test(p)), [], "no run records, secrets or dotfiles");
  const acct = await call({ method: "GET", path: "/v1/account/export", params: PARAM_A, who: WHO.ownerSession });
  assert.equal(acct!.status, 200);
  for (const s of [...NEVER_SHOWN, ...Object.values(TOKENS)]) assert.ok(!acct!.body.includes(s), `the account export holds ${s.slice(0, 18)}…`);
  assert.ok(!/"(hash|salt)"/.test(acct!.body));
});

// ---- who may see whose keys and people ---------------------------------------------------------------
test("the key list and the team list show each caller only what its role and scope allow, and never a hash", async () => {
  const keysOf = async (who: Who) => (JSON.parse((await call({ method: "GET", path: "/v1/keys", params: PARAM_A, who }))!.body) as { keys: { id: string }[] }).keys.map((k) => k.id).sort();
  const admin = await keysOf(WHO.adminKey);
  assert.ok(admin.includes(IDS.keyViewer) && admin.includes(IDS.keyAdmin) && admin.includes(IDS.keyScoped), "an unlimited admin sees the account's keys");
  assert.ok(!admin.includes(IDS.keyB), "never another account's");
  assert.deepEqual(await keysOf(WHO.scopedKey), [IDS.keyScoped], "an admin limited to one workspace sees only keys inside it");
  assert.deepEqual(await keysOf(WHO.strangerKey), [IDS.keyB]);
  for (const who of [WHO.viewerKey, WHO.editorKey, WHO.viewerSession, WHO.scopedSession, WHO.anon]) assert.ok([401, 403].includes((await call({ method: "GET", path: "/v1/keys", params: PARAM_A, who }))!.status), `${who.label} cannot list keys`);
  // The team list: the people of the caller's own account, no credentials.
  const team = JSON.parse((await call({ method: "GET", path: "/v1/team", params: PARAM_A, who: WHO.viewerSession }))!.body) as { members: Record<string, unknown>[] };
  assert.ok(team.members.length >= 5 && team.members.every((m) => !("hash" in m) && !("salt" in m) && !("password" in m) && !("mfa" in m)));
  const other = JSON.parse((await call({ method: "GET", path: "/v1/team", params: PARAM_A, who: WHO.strangerSession }))!.body) as { members: { email: string }[] };
  assert.deepEqual(other.members.map((m) => m.email), ["owner@" + B.emailDomain]);
});
