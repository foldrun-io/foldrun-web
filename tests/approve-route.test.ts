// The emailed-link door: a GET shows the gate and decides nothing, a POST
// decides what the link may, and every way a link cannot decide is a
// sentence on a page rather than a status code.
//
//   node --import ./tests/register.mjs --test tests/approve-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-approve-route-"));
const { NextRequest } = await import("next/server");
const { GET, POST } = await import("../app/api/approve/[tenant]/[workspace]/[runId]/route.ts");
const { approveLinkToken } = await import("../../foldrun-core/src/approvals.ts");
const { approveToken } = await import("../../foldrun-core/src/webhook.ts");
const { writeRun, readRun } = await import("../../foldrun-core/src/store.ts");

const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(ws, "flows", "publish.md"), "---\nname: publish\n---\n\n1! [[writer]] — draft it\n");
fs.writeFileSync(path.join(ws, "flows", "guarded.md"), "---\nname: guarded\napprovers: [ops@example.com]\n---\n\n1! [[writer]] — draft it\n");

const park = (id: string, flow = "publish") =>
  writeRun("acme", "desk", {
    id,
    flow,
    status: "awaiting-approval",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: [{ agent: "writer", instruction: "draft it", group: 1, optional: false, approve: true, ask: "Ship it?", status: "awaiting-approval", events: [], result: null, costUsd: 0 }],
  });

const ctx = (runId: string) => ({ params: Promise.resolve({ tenant: "acme", workspace: "desk", runId }) });
const get = (runId: string, token: string) => GET(new NextRequest(`http://x/api/approve/acme/desk/${runId}?token=${token}`), ctx(runId));
const post = (runId: string, token: string, decision = "approve") =>
  POST(
    new NextRequest(`http://x/api/approve/acme/desk/${runId}?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ decision }),
    }),
    ctx(runId),
  );

test("a step link: the page shows the gate and its terms; the POST decides it; a second POST is told it was used", async () => {
  park("run-1");
  const token = approveLinkToken("acme", "desk", "run-1", { step: 0, expiresAt: Date.now() + 60_000 });
  const page = await get("run-1", token);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Ship it\?/);
  assert.match(html, /for this gate only, once/);
  assert.equal(readRun("acme", "desk", "run-1")!.steps[0].status, "awaiting-approval", "a GET decides nothing");
  const done = await post("run-1", token);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { ok: true, decision: "approve", steps: [0] });
  assert.equal(readRun("acme", "desk", "run-1")!.steps[0].status, "pending");
  const again = await post("run-1", token);
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already used/);
});

test("a bad token is a 401 that names no run; an expired one is a page that says so", async () => {
  park("run-2");
  assert.equal((await get("run-2", "nope")).status, 401);
  assert.equal((await get("run-nowhere", "nope")).status, 401, "no run enumeration");
  const dead = approveLinkToken("acme", "desk", "run-2", { step: 0, expiresAt: Date.now() - 1 });
  const res = await get("run-2", dead);
  assert.equal(res.status, 410);
  assert.match(await res.text(), /This link has expired/);
  assert.equal((await post("run-2", dead)).status, 410);
});

test("a flow with approvers: refuses an anonymous link with a clear page, and takes a named one", async () => {
  park("run-3", "guarded");
  const anon = approveLinkToken("acme", "desk", "run-3", { step: 0, expiresAt: Date.now() + 60_000 });
  const res = await get("run-3", anon);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /cannot decide this gate[\s\S]*carries no identity/);
  assert.equal((await post("run-3", anon)).status, 403);
  const ops = approveLinkToken("acme", "desk", "run-3", { step: 0, expiresAt: Date.now() + 60_000, approver: "ops@example.com" });
  assert.match(await (await get("run-3", ops)).text(), /sent to <strong>ops@example.com<\/strong>/);
  const done = await post("run-3", ops, "reject");
  assert.equal(done.status, 200);
  const step = readRun("acme", "desk", "run-3")!.steps[0];
  assert.equal(step.status, "failed");
  assert.match(step.events.at(-1)!.text, /rejected via emailed link \(ops@example\.com\)/);
});

test("the older run-bound link still opens a waiting run, once", async () => {
  park("run-4");
  const legacy = approveToken("acme", "desk", "run-4");
  assert.equal((await get("run-4", legacy)).status, 200);
  assert.equal((await post("run-4", legacy)).status, 200);
  assert.equal((await post("run-4", legacy)).status, 409);
});
