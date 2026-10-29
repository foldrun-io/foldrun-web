// FOL-106: `?wait=true` on a run that fails on its own terms is a 200.
//
// The 28 Oct e2e on dev: POST …/agents/<a>/run?wait=true answered 500 every
// time the run failed for want of a model key, while the run record was fine.
// A failed run is the answer to the call, not a fault in it — a 500 paged
// whoever watches 5xx and told clients to retry a run that had ended. Now it
// is 200 with the run's `status` and `failure` (agent + reason); a start that
// is refused before any run exists (a paused workspace) keeps its 4xx.
//
// No agent runs here (FOLDRUN_DISABLE_WORKER): the test plays the worker by
// finishing the run record itself, so nothing can reach a model or this
// machine's login.
//
//   node --import ./tests/register.mjs --test tests/wait-failed-run.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-wait-failed-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
// Belt and braces: nothing here runs an agent, and if something did it must
// not find this machine's login.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-fol106";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { readRun, writeRun } = await import("@/lib/store");
type Handler<P> = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<P> }) => Promise<Response>;
const agentRun = (await import("../app/api/workspaces/[workspace]/agents/[agent]/run/route.ts")) as { POST: Handler<{ workspace: string; agent: string }> };
const flowRun = (await import("../app/api/workspaces/[workspace]/flows/[flow]/run/route.ts")) as { POST: Handler<{ workspace: string; flow: string }> };
const pause = (await import("../app/api/workspaces/[workspace]/pause/route.ts")) as { POST: Handler<{ workspace: string }>; DELETE: Handler<{ workspace: string }> };

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
fs.writeFileSync(path.join(ws, "flows/daily.md"), "---\nname: daily\n---\n\n1. [[writer]] — write it\n");
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

const NO_KEY = "no model key: this account runs on its own API key, and none is set — add one in Settings → Model";

/** Play the worker: the first queued run that appears is finished as told. */
function finishNextRun(status: "failed" | "completed", seen: Set<string>) {
  return new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const tick = () => {
      const id = fs.existsSync(path.join(ws, "runs")) && fs.readdirSync(path.join(ws, "runs")).map((f) => f.match(/^(run-[^.]+)\.json$/)?.[1]).find((x) => x && !seen.has(x));
      if (id) {
        seen.add(id);
        const run = readRun(TENANT, WS, id)!;
        const now = new Date().toISOString();
        run.status = status;
        run.finishedAt = now;
        run.steps = run.steps.map((s) => ({
          ...s,
          status,
          events: [...(s.events ?? []), status === "failed" ? { t: now, type: "error", text: NO_KEY } : { t: now, type: "result", text: "done" }],
          ...(status === "completed" ? { result: "done" } : {}),
        })) as typeof run.steps;
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
const startAgent = () =>
  agentRun.POST(new NextRequest(`http://localhost/api/workspaces/${WS}/agents/writer/run?wait=true&timeout=10`, { method: "POST", headers, body: JSON.stringify({ task: "hi" }) }), {
    params: Promise.resolve({ workspace: WS, agent: "writer" }),
  });
const startFlow = () =>
  flowRun.POST(new NextRequest(`http://localhost/api/workspaces/${WS}/flows/daily/run?wait=true&timeout=10`, { method: "POST", headers, body: JSON.stringify({ task: "hi" }) }), {
    params: Promise.resolve({ workspace: WS, flow: "daily" }),
  });

for (const [what, start] of [["agent run", startAgent], ["flow run", startFlow]] as const) {
  test(`${what} ?wait: a run that fails on its own terms answers 200 with its status and reason`, async () => {
    const [res, id] = await Promise.all([start(), finishNextRun("failed", seen)]);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, false);
    assert.equal(body.runId, id);
    assert.equal(body.status, "failed");
    assert.equal(body.failure?.agent, "writer");
    assert.match(body.failure?.reason ?? "", /^no model key/);
    assert.equal(body.steps[0].status, "failed");
  });

  test(`${what} ?wait: a completed run is still 200, ok, with no failure`, async () => {
    const [res] = await Promise.all([start(), finishNextRun("completed", seen)]);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, "completed");
    assert.equal(body.failure, null);
  });
}

test("a start refused before any run exists (a paused workspace) stays a 4xx, and queues nothing", async () => {
  const ctx = { params: Promise.resolve({ workspace: WS }) };
  const paused = await pause.POST(new NextRequest(`http://localhost/api/workspaces/${WS}/pause`, { method: "POST", headers, body: JSON.stringify({ reason: "maintenance" }) }), ctx);
  assert.equal(paused.status, 200, await paused.clone().text());
  const before = fs.readdirSync(path.join(ws, "runs")).length;
  for (const res of [await startAgent(), await startFlow()]) {
    const body = await res.json();
    assert.equal(res.status, 423, JSON.stringify(body));
    assert.match(body.error, /paused/);
  }
  assert.equal(fs.readdirSync(path.join(ws, "runs")).length, before, "no run record was made");
  await pause.DELETE(new NextRequest(`http://localhost/api/workspaces/${WS}/pause`, { method: "DELETE", headers }), ctx);
});
