// POST /api/events/<tenant>/<ws>/<run>: a URL releases its own step's park
// and nothing else (30 Oct 2026). The token was per run and never expired,
// so a URL handed out for a flow's first `wait: event` also released its
// second. Now `&step=` names the gate, a spent URL is a 409, a wrong token or
// another step's is a 401, and the old per-run form still releases a step
// parked under it (a run already waiting when this shipped).
//
//   node --import ./tests/register.mjs --test tests/event-gate-tokens.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-event-gates-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const { NextRequest } = await import("next/server");
const route = await import("../app/api/events/[tenant]/[workspace]/[runId]/route.ts");
const { eventUrl } = await import("../../foldrun-core/src/webhook.ts");
const { writeRun, readRun } = await import("../../foldrun-core/src/store.ts");

const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");

const AT = "2026-10-30T01:00:00.000Z";
const parkedStep = (agent: string, group: number, text: string) => ({
  agent, instruction: "wait", group, optional: false, waitFor: "event",
  status: "awaiting-approval", events: [{ t: AT, type: "info", text }], result: null, costUsd: null,
});
const pendingStep = (agent: string, group: number) => ({
  agent, instruction: "later", group, optional: false, waitFor: "event",
  status: "pending", events: [], result: null, costUsd: null,
});
const LINE = "waiting for an external event — release it with POST ";

const post = (runId: string, pathAndQuery: string) =>
  route.POST(new NextRequest(`http://x${pathAndQuery}`, { method: "POST", body: "paid" }), {
    params: Promise.resolve({ tenant: "acme", workspace: "desk", runId }),
  });

test("a step's URL opens that step; the per-run token, another step's index or a wrong token do not", async () => {
  const id = "run-gates";
  const url = eventUrl("acme", "desk", id, { step: 0, at: AT });
  writeRun("acme", "desk", {
    id, flow: "f", status: "awaiting-approval", startedAt: AT, finishedAt: null,
    steps: [parkedStep("first", 1, LINE + url), pendingStep("second", 2)],
  } as never);
  const u = new URL(url, "http://x");
  const token = u.searchParams.get("token")!;
  const legacyPath = new URL(eventUrl("acme", "desk", id), "http://x");

  assert.equal((await post(id, `${u.pathname}?token=${token}&step=1`)).status, 401, "not another step's");
  assert.equal((await post(id, `${u.pathname}?token=${"0".repeat(32)}&step=0`)).status, 401);
  assert.equal((await post(id, `${u.pathname}?token=${token}&step=x`)).status, 401);
  assert.equal((await post(id, legacyPath.pathname + legacyPath.search)).status, 409, "the old form opens nothing parked since");
  assert.equal(readRun("acme", "desk", id)!.steps[0].status, "awaiting-approval");

  const ok = await post(id, u.pathname + u.search);
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual((await ok.json()).steps, [0]);
  assert.equal(readRun("acme", "desk", id)!.steps[0].eventPayload, "paid");
  assert.equal((await post(id, u.pathname + u.search)).status, 409, "a spent URL is a 409, not a second release");
});

test("a step parked under the old per-run URL is still released by it", async () => {
  const id = "run-legacy";
  const old = eventUrl("acme", "desk", id);
  writeRun("acme", "desk", {
    id, flow: "f", status: "awaiting-approval", startedAt: AT, finishedAt: null,
    steps: [parkedStep("first", 1, LINE + old)],
  } as never);
  const res = await post(id, new URL(old, "http://x").pathname + new URL(old, "http://x").search);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual((await res.json()).steps, [0]);
});
