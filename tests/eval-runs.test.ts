// An async eval run (server/eval-runs.ts): one lease at a time, and every
// poll answered for the run asked about — its own result, its own failure,
// "lost" when its lease went quiet, "unavailable" for an id not on record.
// The cases the Codex debate of 21 Oct 2026 set as the bar.
//
//   node --import ./tests/register.mjs --test tests/eval-runs.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-evalruns-"));
process.env.FOLDRUN_DATA = root;
fs.mkdirSync(path.join(root, "acme", "workspaces", "desk", "evals"), { recursive: true });
const { claimEvalRun, readEvalRun, currentEvalRun, claimEvalCompare, readEvalCompare, currentEvalCompare, pastEvalCompares } = await import("../server/eval-runs.ts");

const result = (passed: number) => ({ eval: "quality", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), passed, failed: 1 - passed, costUsd: 0, cases: [] });

test("two claims at once: one wins; its poll is its own, even after the next run takes the eval", async () => {
  const [a, twin] = await Promise.all([claimEvalRun("acme", "desk", "quality"), claimEvalRun("acme", "desk", "quality")]);
  assert.equal([a, twin].filter(Boolean).length, 1);
  const first = (a ?? twin)!;
  assert.equal((await readEvalRun("acme", "desk", "quality", first.runId)).state, "running");
  assert.equal((await currentEvalRun("acme", "desk", "quality"))?.runId, first.runId);
  await first.finish({ result: result(1) });
  // The next run starts — and a deploy's eval would write the shared latest
  // file — but the first caller still reads its own verdict.
  const next = (await claimEvalRun("acme", "desk", "quality"))!;
  const view = await readEvalRun("acme", "desk", "quality", first.runId);
  assert.equal(view.state, "done");
  assert.equal(view.state === "done" && view.result.passed, 1);
  assert.equal((await readEvalRun("acme", "desk", "quality", next.runId)).state, "running");
  await next.finish({ error: "agent writer not found" });
  const failed = await readEvalRun("acme", "desk", "quality", next.runId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.state === "failed" && failed.error, "agent writer not found");
});

test("a lease gone quiet is lost, not done; the successor's lease is safe from the old owner", async () => {
  const old = (await claimEvalRun("acme", "desk", "speed"))!;
  const later = Date.now() + 10 * 60_000;
  assert.equal((await readEvalRun("acme", "desk", "speed", old.runId, later)).state, "lost");
  const successor = (await claimEvalRun("acme", "desk", "speed", later))!;
  assert.ok(successor);
  // The old owner wakes and finishes: it records its own outcome, and leaves
  // the successor's lease alone.
  await old.finish({ result: result(0) });
  assert.equal((await readEvalRun("acme", "desk", "speed", old.runId)).state, "done");
  assert.equal((await currentEvalRun("acme", "desk", "speed", later))?.runId, successor.runId);
  await successor.finish({ result: result(1) });
});

test("an id not on record is unavailable — never a success", async () => {
  const v = await readEvalRun("acme", "desk", "quality", "0123456789abcdef01234567");
  assert.equal(v.state, "unavailable");
  assert.equal((await readEvalRun("acme", "desk", "quality", "../../etc")).state, "unavailable");
});

test("an outcome that cannot be saved keeps the lease: the run reads lost, never done", async () => {
  const run = (await claimEvalRun("acme", "desk", "fragile"))!;
  const dir = path.join(root, "acme", "workspaces", "desk", "evals", ".results", "runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fragile"), "a file where the runs folder should be");
  await run.finish({ result: result(1) });
  assert.equal((await currentEvalRun("acme", "desk", "fragile"))?.runId, run.runId, "not freed without a saved outcome");
  assert.equal((await readEvalRun("acme", "desk", "fragile", run.runId, Date.now() + 10 * 60_000)).state, "lost");
});

test("a comparison is its own lane: beside an eval run, with progress, its outcomes listed newest first", async () => {
  const run = (await claimEvalRun("acme", "desk", "lanes"))!;
  const cmp = (await claimEvalCompare("acme", "desk", "lanes"))!;
  assert.ok(run && cmp, "an eval run and a comparison of one eval do not block each other");
  assert.equal(await claimEvalCompare("acme", "desk", "lanes"), null, "but two comparisons do");
  await cmp.progress(3, 8);
  const view = await readEvalCompare("acme", "desk", "lanes", cmp.runId);
  assert.equal(view.state, "running");
  assert.deepEqual(view.state === "running" && view.progress, { done: 3, total: 8 });
  assert.equal((await currentEvalCompare("acme", "desk", "lanes"))?.progress?.done, 3);
  await cmp.finish({ result: { eval: "lanes", configs: [], cases: [] } as never });
  await run.finish({ result: result(1) });
  const again = (await claimEvalCompare("acme", "desk", "lanes"))!;
  await again.finish({ error: "stopped" });
  const past = pastEvalCompares("acme", "desk", "lanes");
  assert.deepEqual(past.map((p) => p.runId).sort(), [cmp.runId, again.runId].sort());
  assert.equal((await readEvalRun("acme", "desk", "lanes", cmp.runId)).state, "unavailable", "a comparison is not an eval run");
});
