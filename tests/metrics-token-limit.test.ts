// GET /api/metrics: wrong scrape tokens are counted like the open
// callbacks' (server/limits.ts), and the right token is never throttled by
// them. 30 Oct 2026.
//
//   node --import ./tests/register.mjs --test tests/metrics-token-limit.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-metrics-limit-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const route = await import("../app/api/metrics/route.ts");

const scrape = (token: string, ip: string) =>
  route.GET(new NextRequest("http://x/api/metrics", { headers: { authorization: `Bearer ${token}`, "x-forwarded-for": ip } }));

test("with no token configured the route is closed and counts nothing", async () => {
  delete process.env.FOLDRUN_METRICS_TOKEN;
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    for (let i = 0; i < 35; i++) assert.equal((await scrape("guess", "203.0.113.50")).status, 404);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("wrong tokens are a 404 thirty times a minute per caller, then a 429; another caller and the right token are unaffected", async () => {
  process.env.FOLDRUN_METRICS_TOKEN = "m".repeat(40);
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await scrape(i % 2 ? "wrong" : "é".repeat(40), "203.0.113.51")).status);
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(404));
    assert.ok(statuses.slice(30).every((s) => s === 429), `after 30: ${statuses.slice(30)}`);
    assert.equal((await scrape("wrong", "198.51.100.9")).status, 404, "another caller is unaffected");
    const ok = await scrape("m".repeat(40), "203.0.113.51");
    assert.notEqual(ok.status, 429, "the right token is compared before any count");
    assert.notEqual(ok.status, 404);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
    delete process.env.FOLDRUN_METRICS_TOKEN;
  }
});
