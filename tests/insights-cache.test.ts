// GET /api/insights and the Observe page read whole run records — up to 300
// a workspace — so the answer is remembered for 30 s per account, scope,
// window and workspace (server/insights.ts). 30 Oct 2026.
//
//   node --import ./tests/register.mjs --test tests/insights-cache.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-insights-cache-"));
const { cachedAccountInsights, INSIGHTS_TTL_MS } = await import("../server/insights.ts");

test("within the TTL the same answer is returned without reading again; after it, a fresh one", () => {
  const t0 = 1_000_000;
  const first = cachedAccountInsights("acme", null, 7, null, t0);
  assert.equal(cachedAccountInsights("acme", null, 7, null, t0 + INSIGHTS_TTL_MS - 1), first, "remembered");
  assert.notEqual(cachedAccountInsights("acme", null, 7, null, t0 + INSIGHTS_TTL_MS), first, "read again once stale");
});

test("account, scope, window and workspace each have their own entry — never another caller's answer", () => {
  const t0 = 5_000_000;
  const all = cachedAccountInsights("acme", null, 7, null, t0);
  assert.notEqual(cachedAccountInsights("acme", ["desk"], 7, null, t0), all, "a scoped caller is not served the unscoped answer");
  assert.notEqual(cachedAccountInsights("other", null, 7, null, t0), all);
  assert.notEqual(cachedAccountInsights("acme", null, 30, null, t0), all);
  assert.notEqual(cachedAccountInsights("acme", null, 7, "desk", t0), all);
  // Scope order does not split the entry.
  const ab = cachedAccountInsights("acme", ["a", "b"], 7, null, t0);
  assert.equal(cachedAccountInsights("acme", ["b", "a"], 7, null, t0), ab);
});

test("the route and the Observe page both read through the cache", () => {
  for (const f of ["../app/api/insights/route.ts", "../app/dashboard/observe/page.tsx"]) {
    const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /cachedAccountInsights\(/, f);
    assert.doesNotMatch(src, /\baccountInsights\(/, `${f} reads uncached`);
  }
});
