// A stranger with no token cannot wipe a workspace's delivery log, and
// cannot throttle the real sender either.
//
//   node --import ./tests/register.mjs --test tests/hook-flood.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hook-flood-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
const { NextRequest } = await import("next/server");
const { POST } = await import("../app/api/hooks/[tenant]/[workspace]/[flow]/route.ts");
const { recordDelivery, readDeliveries, webhookToken } = await import("../../foldrun-core/src/webhook.ts");

const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");

const hit = (flow: string, token: string, ip?: string) =>
  POST(
    new NextRequest(`http://x/api/hooks/acme/desk/${flow}?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
      body: "{}",
    }),
    { params: Promise.resolve({ tenant: "acme", workspace: "desk", flow }) },
  );

test("a thousand bad tokens are one line, and the owner's real deliveries survive", async () => {
  for (let i = 0; i < 20; i++) recordDelivery("acme", "desk", { t: new Date().toISOString(), flow: "intake", outcome: "accepted", runId: `run-${i}` });
  // No proxy trusted here, so no per-IP limit: the collapse alone must hold.
  delete process.env.FOLDRUN_TRUST_PROXY;
  // Varying the flow name each time — it comes from the URL, so a flood can.
  for (let i = 0; i < 1000; i++) assert.equal((await hit(`flow-${i % 7}`, "wrong")).status, 401);

  const log = readDeliveries("acme", "desk", 1000);
  assert.equal(log.filter((d) => d.outcome === "accepted").length, 20, "every accepted delivery is still there");
  const refused = log.filter((d) => d.outcome === "invalid-token");
  assert.equal(refused.length, 1, "the flood is one line");
  assert.equal(refused[0].count, 1000);
  assert.ok(refused[0].first, "it says when the flood began");
  assert.equal(refused[0].detail, "more than one flow name");

  // A real delivery after the flood starts a new line; the next refusal
  // does not fold into anything older than it.
  recordDelivery("acme", "desk", { t: new Date().toISOString(), flow: "intake", outcome: "accepted", runId: "run-after" });
  await hit("intake", "wrong");
  const [latest, real] = readDeliveries("acme", "desk", 2);
  assert.equal(latest.outcome, "invalid-token");
  assert.equal(latest.count, undefined);
  assert.equal(real.runId, "run-after");
});

test("behind a trusted proxy, one caller's bad tokens are throttled — and the right token still gets through", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await hit("intake", "wrong", "203.0.113.9")).status);
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401));
    assert.ok(statuses.slice(30).every((s) => s === 429), `after 30: ${statuses.slice(30)}`);

    // Another caller is unaffected.
    assert.equal((await hit("intake", "wrong", "198.51.100.4")).status, 401);
    // The same address with the right token is past the limiter: whatever
    // the flow says next, it is not a 429.
    const good = await hit("intake", webhookToken("acme", "desk", "intake"), "203.0.113.9");
    assert.notEqual(good.status, 429);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});
