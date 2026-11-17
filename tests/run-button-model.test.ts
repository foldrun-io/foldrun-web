// The Run button: what it posts (the task reaches the agent, a blank one does
// not) and where a started run opens.
//
//   node --import ./tests/register.mjs --test tests/run-button-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { runBodyOf, runPageOf } from "../components/run-button-model.ts";

test("a task is sent trimmed, a blank one is not, test only when asked; a started run opens its page", () => {
  assert.deepEqual(runBodyOf("  summarise q4  ", false), { task: "summarise q4" });
  assert.deepEqual(runBodyOf("   ", false), {});
  assert.deepEqual(runBodyOf("x", true), { task: "x", test: true });

  const ep = "/api/workspaces/testnov17/agents/summarizer/run";
  assert.equal(runPageOf(ep, "run-abc", "default"), "/dashboard/testnov17/runs/run-abc");
  assert.equal(runPageOf(ep, "run-abc", "acme"), "/dashboard/testnov17/runs/run-abc?tenant=acme");
  assert.equal(runPageOf(ep, undefined, "default"), null);
  assert.equal(runPageOf("/api/other", "run-abc", "default"), null);
});
