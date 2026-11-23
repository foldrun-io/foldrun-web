// A waited start (`?wait=true`) with an Idempotency-Key starts ONE run, however
// it is retried (17 Nov 2026, reported by a partner on prod: the same key and
// body, sent twice with ?wait, started two runs and no replay came back).
//
// No agent runs here (FOLDRUN_DISABLE_WORKER): a run stays queued, so a waited
// call answers 202 "not finished" when its timeout passes.
//
//   node --import ./tests/register.mjs --test tests/idempotency-wait.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-idem-wait-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-idem-wait";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { resetIdempotencyMemory } = await import("../server/idempotency.ts");
const { readRun, writeRun } = await import("@/lib/store");
type Handler<P> = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<P> }) => Promise<Response>;
const flowRun = (await import("../app/v1/workspaces/[workspace]/flows/[flow]/run/route.ts")) as { POST: Handler<{ workspace: string; flow: string }> };

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
// overlap: queue, so a second start is never refused for overlap — only the
// key may stop it.
fs.writeFileSync(path.join(ws, "flows/screen.md"), "---\nname: screen\noverlap: queue\n---\n\n1. [[writer]] — score it\n");
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");

const runsOnDisk = () => (fs.existsSync(path.join(ws, "runs")) ? fs.readdirSync(path.join(ws, "runs")).filter((f) => /^run-[^.]+\.json$/.test(f)).length : 0);

function start(idem: string, query: string, body: Record<string, unknown> = { task: "applicant 7", test: true }) {
  return flowRun.POST(
    new NextRequest(`http://localhost/v1/workspaces/${WS}/flows/screen/run${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": idem },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: WS, flow: "screen" }) },
  );
}

/** Play the worker: finish the first queued run that appears. */
function finishNextRun(seen: Set<string>) {
  return new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const tick = () => {
      const id = fs.existsSync(path.join(ws, "runs")) && fs.readdirSync(path.join(ws, "runs")).map((f) => f.match(/^(run-[^.]+)\.json$/)?.[1]).find((x) => x && !seen.has(x));
      if (id) {
        seen.add(id);
        const run = readRun(TENANT, WS, id)!;
        const now = new Date().toISOString();
        run.status = "completed";
        run.finishedAt = now;
        run.steps = run.steps.map((st) => ({ ...st, status: "completed", result: "score 91", events: [...(st.events ?? []), { t: now, type: "result", text: "score 91" }] })) as typeof run.steps;
        writeRun(TENANT, WS, run);
        return resolve(id);
      }
      if (Date.now() > deadline) return reject(new Error("no run was queued"));
      setTimeout(tick, 50);
    };
    tick();
  });
}
const seen = new Set<string>();

test("a waited start whose run COMPLETED, retried after its 200, starts no second run (the prod report)", async () => {
  resetIdempotencyMemory();
  for (const f of fs.existsSync(path.join(ws, "runs")) ? fs.readdirSync(path.join(ws, "runs")) : []) seen.add(f.replace(/\.json$/, ""));
  const before = runsOnDisk();
  const [first, id] = await Promise.all([start("k-done", "?wait=true&timeout=5"), finishNextRun(seen)]);
  const a = await first.json();
  assert.equal(first.status, 200, JSON.stringify(a));
  assert.equal(a.runId, id);
  const again = await start("k-done", "?wait=true&timeout=5");
  const b = await again.json();
  assert.equal(runsOnDisk() - before, 1, `one run, not two (retry answered ${again.status}, replayed=${again.headers.get("idempotent-replayed")})`);
  assert.equal(b.runId, a.runId, `retry answered ${again.status} ${JSON.stringify(b)}`);
});

test("a waited start retried after its answer starts one run, and the retry is a replay", async () => {
  resetIdempotencyMemory();
  const before = runsOnDisk();
  const first = await start("k-seq", "?wait=true&timeout=1");
  const a = await first.json();
  assert.equal(first.status, 202, JSON.stringify(a));
  const again = await start("k-seq", "?wait=true&timeout=1");
  const b = await again.json();
  assert.equal(runsOnDisk() - before, 1, "one run, not two");
  assert.equal(b.runId, a.runId, JSON.stringify(b));
});

test("a waited start retried while the first is still waiting starts one run", async () => {
  resetIdempotencyMemory();
  const before = runsOnDisk();
  const first = start("k-overlap", "?wait=true&timeout=2");
  await new Promise((r) => setTimeout(r, 500));
  const second = await start("k-overlap", "?wait=true&timeout=2");
  const s = await second.json();
  const f = await (await first).json();
  assert.equal(runsOnDisk() - before, 1, `one run, not two (second answered ${second.status} ${JSON.stringify(s)})`);
  assert.ok(second.status === 409 || s.runId === f.runId, JSON.stringify(s));
});

test("a waited start retried WITHOUT ?wait (or with another timeout) is the same request: one run, the same id", async () => {
  resetIdempotencyMemory();
  const before = runsOnDisk();
  const first = await start("k-mixed", "?wait=true&timeout=1");
  const a = await first.json();
  const plain = await start("k-mixed", "");
  const p = await plain.json();
  assert.notEqual(plain.status, 422, JSON.stringify(p));
  assert.equal(p.runId, a.runId, JSON.stringify(p));
  const other = await start("k-mixed", "?wait=1&timeout=3");
  const o = await other.json();
  assert.notEqual(other.status, 422, JSON.stringify(o));
  assert.equal(o.runId, a.runId, JSON.stringify(o));
  assert.equal(runsOnDisk() - before, 1, "one run, not three");
});

test("the same key with a different body is still refused (422), and starts nothing", async () => {
  resetIdempotencyMemory();
  await (await start("k-body", "?wait=true&timeout=1")).json();
  const before = runsOnDisk();
  const res = await start("k-body", "?wait=true&timeout=1", { task: "applicant 8", test: true });
  assert.equal(res.status, 422, await res.clone().text());
  assert.equal(runsOnDisk(), before);
});

test("wait and timeout are ignored only on routes that start a run", async () => {
  const { requestQuery } = await import("../server/idempotency.ts");
  assert.equal(requestQuery(new URL("http://x/v1/workspaces/w/flows/f/run?wait=true&timeout=25")), "");
  assert.equal(requestQuery(new URL("http://x/v1/workspaces/w/runs/r1/rerun?from=2&wait=1")), "?from=2");
  assert.equal(requestQuery(new URL("http://x/v1/workspaces/w/deploy?wait=true")), "?wait=true", "elsewhere the query counts as sent");
});
