// The stream's deltas and cursor (FOL-158): what changed, from where, and the
// whole record when a cursor does not fit.
//
//   node --import ./tests/register.mjs --test tests/run-delta.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { cursorOf, parseCursor, deltaSince } from "../server/run-delta.ts";

const run = (status: string, ...events: number[]) => ({
  id: "r1",
  status,
  steps: events.map((n, i) => ({ agent: `a${i}`, status: n > 1 ? "completed" : "running", events: Array.from({ length: n }, (_, k) => ({ type: "text", text: `e${k}` })) })),
});

test("a cursor is each step's event count, and parses back", () => {
  assert.equal(cursorOf(run("running", 2, 0)), "v1.2-0");
  assert.deepEqual(parseCursor("v1.2-0"), [2, 0]);
  assert.deepEqual(parseCursor("v1."), []);
  assert.equal(parseCursor("garbage"), null);
  assert.equal(parseCursor(null), null);
});

test("a delta carries the new events of the steps that grew, and the steps whose fields changed", () => {
  const before = run("running", 1, 0);
  const first = deltaSince(before, [0, 0])!;
  const now = run("running", 2, 1);
  const d = deltaSince(now, [1, 0], first.headers)!.delta as { status: string; steps: Record<string, { events: unknown[]; from: number; status: string }> };
  assert.equal(d.status, "running");
  assert.equal(d.steps[0]!.from, 1);
  assert.equal(d.steps[0]!.events.length, 1, "only the new event");
  assert.equal(d.steps[0]!.status, "completed", "the step's fields come with it");
  assert.equal(d.steps[1]!.events.length, 1);
  const quiet = deltaSince(now, [2, 1], deltaSince(now, [2, 1])!.headers)!.delta as { steps: Record<string, unknown> };
  assert.deepEqual(quiet.steps, {}, "nothing changed: no steps");
});

test("a cursor that does not fit the record (more steps, more events than there are) is null: send it whole", () => {
  assert.equal(deltaSince(run("running", 1), [1, 0]), null);
  assert.equal(deltaSince(run("running", 1), [5]), null);
});
