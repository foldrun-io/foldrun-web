// GET /api/metrics: the queue's busiest accounts by rank, never by name
// (FOL-123) — a metric's labels are fixed (FOL-121), and an account's name
// is not one.
//
//   node --import ./tests/register.mjs --test tests/metrics-account-queue.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-metrics-queue-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const route = await import("../app/api/metrics/route.ts");

test("ranked per-account queue gauges, with no account named anywhere", async () => {
  const pending = path.join(process.env.FOLDRUN_DATA!, "queue", "pending");
  fs.mkdirSync(pending, { recursive: true });
  const job = (n: number, tenant: string) =>
    fs.writeFileSync(path.join(pending, `${String(n).padStart(14, "0")}000000-run-${tenant}${n}.json`), JSON.stringify({ tenant, workspace: "desk", runId: `run-${tenant}${n}` }));
  for (let i = 0; i < 3; i++) job(i, "floodingcustomer");
  job(9, "quietcustomer");
  process.env.FOLDRUN_METRICS_TOKEN = "m".repeat(40);
  try {
    const res = await route.GET(new NextRequest("http://x/api/metrics", { headers: { authorization: `Bearer ${"m".repeat(40)}` } }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^foldrun_queue_account_pending\{rank="1"\} 3$/m);
    assert.match(text, /^foldrun_queue_account_pending\{rank="2"\} 1$/m);
    assert.match(text, /^foldrun_queue_account_oldest_pending_seconds\{rank="2"\} \d+$/m);
    assert.ok(!/customer/.test(text), "no account's name in the scrape");
    for (const line of text.split("\n").filter((l) => l.startsWith("foldrun_queue_account_"))) {
      assert.match(line, /^foldrun_queue_account_[a-z_]+\{rank="[1-5]"\} \d+$/, line);
    }
  } finally {
    delete process.env.FOLDRUN_METRICS_TOKEN;
  }
});
