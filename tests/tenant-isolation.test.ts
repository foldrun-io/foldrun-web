// One account can never read or change another's. Not argued route by route:
// every route file under app/api is found on disk and every method it
// exports is called — as an attacker holding a real key to their OWN
// account, aimed at the victim's workspace, runs, flows and files by name,
// with the victim's tenant smuggled in every place a request can carry it
// (header, query, body). A route added tomorrow is in this test tomorrow.
//
// The victim's workspace carries a canary in every kind of thing it holds.
// The test fails if the canary appears in any response, or if a single byte
// of the victim's tree changes.
//
//   node --import ./tests/register.mjs --test tests/tenant-isolation.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-isolation-"));
process.env.FOLDRUN_DATA = DATA;
// Nothing here may reach the network or a queue that outlives the test.
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.FOLDRUN_RESEND_API_KEY;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const { setSecret } = await import("../../foldrun-core/src/secrets.ts");

const VICTIM = "victim";
const ATTACKER = "attacker";
const WS = "victim-ws";
const RUN = "run-victim-1";
const FLOW = "victim-flow";
const CANARY = `CANARY-${crypto.randomBytes(8).toString("hex")}`;

// ---- the victim's account: a canary in everything it has ------------------
const vws = path.join(DATA, VICTIM, "workspaces", WS);
for (const d of ["flows", "agents/writer", "knowledge", "memory", "evals", "storage"]) fs.mkdirSync(path.join(vws, d), { recursive: true });
fs.writeFileSync(path.join(vws, "AGENTS.md"), `---\nname: ${WS}\n---\n\n${CANARY} shared context\n`);
fs.writeFileSync(path.join(vws, "agents/writer/agent.md"), `---\nname: writer\n---\n\n${CANARY} persona\n`);
fs.writeFileSync(path.join(vws, "flows", `${FLOW}.md`), `---\nname: ${FLOW}\ntrigger: webhook\n---\n\n1. [[writer]] — ${CANARY}\n`);
fs.writeFileSync(path.join(vws, "knowledge/notes.md"), `${CANARY} knowledge\n`);
fs.writeFileSync(path.join(vws, "memory/learned.md"), `${CANARY} memory\n`);
fs.writeFileSync(path.join(vws, "storage/report.txt"), `${CANARY} file\n`);
writeRun(VICTIM, WS, {
  id: RUN,
  flow: FLOW,
  status: "awaiting-approval",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [{ agent: "writer", instruction: CANARY, group: 1, optional: false, approve: true, ask: CANARY, status: "awaiting-approval", events: [], result: CANARY, costUsd: 0 }],
} as never);
setSecret(VICTIM, "VICTIM_TOKEN", `${CANARY}-secret`, WS);
setSecret(VICTIM, "ACCOUNT_TOKEN", `${CANARY}-account-secret`);

// The attacker: a real account with a real admin key, and a workspace of
// its own — so "not found" is never the only reason a route says no.
const aws = path.join(DATA, ATTACKER, "workspaces", "mine");
fs.mkdirSync(path.join(aws, "flows"), { recursive: true });
fs.writeFileSync(path.join(aws, "AGENTS.md"), "---\nname: mine\n---\n");
const { key: attackerKey } = await createApiKey(ATTACKER, "attack", "evil@attacker.test", undefined, "admin");

// ---- snapshot the victim's tree, to prove nothing was written ----------------
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}
const victimRoot = path.join(DATA, VICTIM);
const before = snapshot(victimRoot);

// ---- every route, every method ---------------------------------------------
const API = path.join(import.meta.dirname, "..", "app", "api");
const routes: string[] = [];
(function find(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) find(p);
    else if (e.name === "route.ts") routes.push(p);
  }
})(API);

// Every dynamic segment is filled with the victim's name for it.
const PARAM: Record<string, string> = {
  workspace: WS, tenant: VICTIM, runId: RUN, flow: FLOW, agent: "writer",
  evalName: "victim-eval", tool: "victim-tool", id: RUN, kind: "agents",
};
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** A body carrying the victim's names everywhere a handler might read one. */
const body = JSON.stringify({
  tenant: VICTIM, account: VICTIM, workspace: WS, path: "AGENTS.md", from: "AGENTS.md", to: "stolen.md",
  content: "overwritten", runId: RUN, runIds: [RUN], flow: FLOW, name: "VICTIM_TOKEN", status: ["running", "failed", "awaiting-approval"],
  action: "stop", decision: "approve", files: { "AGENTS.md": "overwritten" }, source: "AGENTS.md",
});

/** Read at most a little of a response, and never wait on a stream forever. */
async function readSome(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + 1500;
  try {
    while (size < 200_000 && Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
      ]);
      if (next.done || !next.value) break;
      chunks.push(next.value);
      size += next.value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function attackAll(auth: Record<string, string>): Promise<{ calls: number; leaks: string[] }> {
  const leaks: string[] = [];
  let calls = 0;
  for (const file of routes) {
    const rel = path.relative(API, path.dirname(file));
    const params: Record<string, string> = {};
    const urlPath = rel.split(path.sep).map((seg) => {
      const m = seg.match(/^\[(\w+)\]$/);
      if (!m) return seg;
      params[m[1]] = PARAM[m[1]] ?? `victim-${m[1]}`;
      return params[m[1]];
    }).join("/");
    const mod = (await import(file)) as Partial<Record<(typeof METHODS)[number], Handler>>;
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      const qs = `tenant=${VICTIM}&workspace=${WS}&path=AGENTS.md&runId=${RUN}&flow=${FLOW}&account=${VICTIM}`;
      const req = new NextRequest(`http://localhost/api/${urlPath}?${qs}`, {
        method,
        headers: { "content-type": "application/json", "x-foldrun-tenant": VICTIM, ...auth },
        ...(method === "GET" ? {} : { body }),
      });
      calls++;
      let text = "";
      try {
        const res = await handler(req, { params: Promise.resolve({ ...params }) });
        text = await readSome(res);
      } catch (err) {
        // A throw is a refusal, as long as it does not quote the victim.
        text = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      }
      if (text.includes(CANARY)) leaks.push(`${method} /api/${urlPath}`);
    }
  }
  return { calls, leaks };
}

// The one file a stranger may add to, by design: the webhook route writes
// down every refused delivery, so an owner can tell "never fired" from
// "fired into a refusal". It may only ever gain refusals.
const DELIVERIES = path.join("workspaces", WS, "hook-deliveries.jsonl");

function assertVictimUntouched() {
  const after = snapshot(victimRoot);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  assert.deepEqual(changed.filter((k) => k !== DELIVERIES), [], `the victim's files changed: ${changed.join(", ")}`);
  if (changed.includes(DELIVERIES)) {
    const lines = fs.readFileSync(path.join(victimRoot, DELIVERIES), "utf8").split("\n").filter(Boolean);
    for (const l of lines) assert.match(JSON.parse(l).outcome, /^invalid-|^not-webhook$|^no-flow$/, `a stranger's delivery was ${l}`);
  }
}

test("the route list is real: every file under app/api was found", () => {
  assert.ok(routes.length >= 90, `found ${routes.length} routes`);
});

test("with the attacker's own key, no route shows or changes anything of the victim's", async () => {
  const { calls, leaks } = await attackAll({ authorization: `Bearer ${attackerKey}` });
  assert.ok(calls >= 100, `called ${calls} handlers`);
  assert.deepEqual(leaks, [], `the victim's canary came back from: ${leaks.join(", ")}`);
  assertVictimUntouched();
});

test("with no credentials at all, no route shows or changes anything of the victim's", async () => {
  const { leaks } = await attackAll({});
  assert.deepEqual(leaks, [], `the victim's canary came back from: ${leaks.join(", ")}`);
  assertVictimUntouched();
});

test("with a forged key, no route shows or changes anything of the victim's", async () => {
  const { leaks } = await attackAll({ authorization: `Bearer mda_${"0".repeat(48)}` });
  assert.deepEqual(leaks, [], `the victim's canary came back from: ${leaks.join(", ")}`);
  assertVictimUntouched();
});

test("the canary is findable: the victim's own key does read it, so silence above means refusal", async () => {
  // Without this, a test whose requests all failed for a boring reason
  // (a broken fixture, a wrong param) would pass while proving nothing.
  const { key } = await createApiKey(VICTIM, "own", "me@victim.test", undefined, "admin");
  const mod = (await import(path.join(API, "workspaces/[workspace]/source/route.ts"))) as { GET: Handler };
  const res = await mod.GET(
    new NextRequest(`http://localhost/api/workspaces/${WS}/source?path=AGENTS.md`, { headers: { authorization: `Bearer ${key}` } }),
    { params: Promise.resolve({ workspace: WS }) },
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), new RegExp(CANARY));
});
