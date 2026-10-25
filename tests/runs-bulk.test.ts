// The runs bulk bar: a selection across workspaces becomes one runs/bulk
// call per workspace (never over the route's cap), and each answer's
// refusals come back as the bar lists them.

import test from "node:test";
import assert from "node:assert/strict";
import { bulkCalls, refusalsOf, BULK_MAX } from "../components/runs-bulk-model.ts";

test("one call per workspace, in first-seen order, ids deduplicated", () => {
  const calls = bulkCalls([
    { workspace: "b", id: "r1" },
    { workspace: "a", id: "r2" },
    { workspace: "b", id: "r3" },
    { workspace: "b", id: "r1" },
  ]);
  assert.deepEqual(calls, [
    { workspace: "b", runIds: ["r1", "r3"] },
    { workspace: "a", runIds: ["r2"] },
  ]);
});

test("a workspace with more than the cap is split into chunks", () => {
  const runs = Array.from({ length: BULK_MAX + 5 }, (_, i) => ({ workspace: "w", id: `r${i}` }));
  const calls = bulkCalls(runs);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].runIds.length, BULK_MAX);
  assert.equal(calls[1].runIds.length, 5);
  assert.deepEqual(bulkCalls([]), []);
});

test("refusals: per-run failures, and ids the route never matched", () => {
  const call = { workspace: "w", runIds: ["a", "b", "c"] };
  const out = refusalsOf(call, true, {
    runs: [
      { runId: "a", ok: true },
      { runId: "b", ok: false, error: "run b is running — only a finished run can be re-run" },
    ],
  });
  assert.deepEqual(out, [
    "w/b: run b is running — only a finished run can be re-run",
    "w/c: not found (deleted since the page loaded?)",
  ]);
});

test("a call refused whole refuses every run it carried", () => {
  const call = { workspace: "w", runIds: ["a", "b"] };
  assert.deepEqual(refusalsOf(call, false, { error: "forbidden" }, 403), ["w/a: forbidden", "w/b: forbidden"]);
  assert.deepEqual(refusalsOf(call, false, {}, 500), ["w/a: HTTP 500", "w/b: HTTP 500"]);
});
