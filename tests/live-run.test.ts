// The live run panel's rules, pinned apart from the browser: when the page
// has to keep listening, which cards open on their own, that a stale
// snapshot never rolls the picture back, and what the tab says.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isRunTerminal,
  defaultUnfolded,
  activeStep,
  progress,
  newer,
  tabTitle,
  sseFrame,
  eventRelease,
  eventBody,
} from "../components/live-run-model.ts";
import type { RunRecord, StepRecord } from "../../foldrun-core/src/store.ts";

const step = (status: StepRecord["status"], events = 0): StepRecord =>
  ({
    agent: "a",
    instruction: "",
    group: 1,
    optional: false,
    status,
    events: Array.from({ length: events }, (_, i) => ({ t: new Date(i).toISOString(), type: "info", text: "" })),
    result: null,
    costUsd: null,
  }) as unknown as StepRecord;

const run = (status: RunRecord["status"], steps: StepRecord[], extra: Partial<RunRecord> = {}) =>
  ({ id: "run-1", flow: "leads-desk", status, steps, ...extra }) as RunRecord;

test("a gate is a pause, not an end: only completed and failed are terminal", () => {
  assert.equal(isRunTerminal("queued"), false);
  assert.equal(isRunTerminal("running"), false);
  assert.equal(isRunTerminal("awaiting-approval"), false);
  assert.equal(isRunTerminal("completed"), true);
  assert.equal(isRunTerminal("failed"), true);
});

test("while live, only the active step is open", () => {
  const r = run("running", [step("completed"), step("running"), step("pending")]);
  assert.deepEqual([0, 1, 2].map((i) => defaultUnfolded(r, i)), [false, true, false]);
});

test("a step waiting for room opens, its run in the queue or not", () => {
  const waiting = { ...step("pending"), roomWait: { since: "2026-10-27T00:00:00Z", why: "full", cpus: 1, memGiB: 1 } };
  const r = run("queued", [step("completed"), waiting, step("pending")]);
  assert.deepEqual([0, 1, 2].map((i) => defaultUnfolded(r, i)), [false, true, false]);
});

test("a parallel group opens every step that is moving", () => {
  const r = run("running", [step("completed"), step("running"), step("running"), step("pending")]);
  assert.deepEqual([0, 1, 2, 3].map((i) => defaultUnfolded(r, i)), [false, true, true, false]);
});

test("a step waiting at a gate is open; the finished ones before it are not", () => {
  const r = run("awaiting-approval", [step("completed"), step("awaiting-approval"), step("pending")]);
  assert.deepEqual([0, 1, 2].map((i) => defaultUnfolded(r, i)), [false, true, false]);
});

test("when the next step starts, the previous one folds", () => {
  const before = run("running", [step("running"), step("pending")]);
  const after = run("running", [step("completed"), step("running")]);
  assert.deepEqual([0, 1].map((i) => defaultUnfolded(before, i)), [true, false]);
  assert.deepEqual([0, 1].map((i) => defaultUnfolded(after, i)), [false, true]);
});

test("a queued run shows nothing open — no step has started", () => {
  const r = run("queued", [step("pending"), step("pending")]);
  assert.deepEqual([0, 1].map((i) => defaultUnfolded(r, i)), [false, false]);
});

test("on a finished run the failed step stays open", () => {
  const r = run("failed", [step("completed"), step("failed"), step("skipped")]);
  assert.deepEqual([0, 1, 2].map((i) => defaultUnfolded(r, i)), [false, true, false]);
});

test("on a completed run the last step that ran is open, not a trailing skipped branch", () => {
  const r = run("completed", [step("completed"), step("completed"), step("skipped")]);
  assert.deepEqual([0, 1, 2].map((i) => defaultUnfolded(r, i)), [false, true, false]);
});

test("the active step is the running one, else the waiting one, else the default", () => {
  assert.equal(activeStep(run("running", [step("completed"), step("running")])), 1);
  assert.equal(activeStep(run("awaiting-approval", [step("completed"), step("awaiting-approval")])), 1);
  assert.equal(activeStep(run("failed", [step("failed"), step("skipped")])), 0);
  assert.equal(activeStep(run("queued", [])), -1);
  assert.equal(activeStep(run("queued", [step("pending"), step("pending")])), -1);
  assert.equal(activeStep(run("running", [step("completed"), step("pending")])), -1, "between steps nothing is active");
});

test("progress only grows as a run moves", () => {
  const seq = [
    run("queued", [step("pending"), step("pending")]),
    run("running", [step("running", 1), step("pending")]),
    run("running", [step("running", 5), step("pending")]),
    run("awaiting-approval", [step("completed", 5), step("awaiting-approval")]),
    run("running", [step("completed", 5), step("running", 1)]),
    run("completed", [step("completed", 5), step("completed", 9)]),
  ];
  for (let i = 1; i < seq.length; i++) {
    assert.ok(progress(seq[i]) > progress(seq[i - 1]), `step ${i} of the sequence went backwards`);
  }
});

test("an approval is progress: the stamped pending step outranks the gate it left", () => {
  const parked = run("awaiting-approval", [step("completed", 5), step("awaiting-approval", 1)]);
  const approved = run("awaiting-approval", [step("completed", 5), { ...step("pending", 2), approvedAt: "2026-09-06T13:05:31.976Z" }]);
  const resumed = run("running", [step("completed", 5), step("running", 3)]);
  assert.ok(progress(approved) > progress(parked), "the approval write must not read as stale");
  assert.ok(progress(resumed) > progress(approved), "and the worker's first write is newer still");
  assert.equal(newer(parked, approved), approved);
  // A plain pending step — never asked — still sits below a gate.
  const never = run("awaiting-approval", [step("completed", 5), step("pending", 2)]);
  assert.ok(progress(never) < progress(parked));
});

test("a stale server snapshot does not replace what the stream showed", () => {
  const streamed = run("running", [step("completed", 5), step("running", 1)]);
  const snapshot = run("awaiting-approval", [step("completed", 5), step("awaiting-approval")]);
  assert.equal(newer(streamed, snapshot), streamed);
  // Equal progress takes the incoming record: it may carry a newer cost.
  const same = run("running", [step("completed", 5), step("running", 1)]);
  assert.equal(newer(streamed, same), same);
  // A newer one replaces it.
  const later = run("completed", [step("completed", 5), step("completed", 3)]);
  assert.equal(newer(streamed, later), later);
});

test("the tab title says the state, the step and the flow", () => {
  assert.equal(tabTitle(run("running", [step("completed"), step("running"), step("pending")])), "● running · step 2/3 · leads-desk · foldrun");
  assert.equal(tabTitle(run("awaiting-approval", [step("awaiting-approval")])), "◐ waiting · step 1/1 · leads-desk · foldrun");
  assert.equal(tabTitle(run("completed", [step("completed")])), "✓ completed · step 1/1 · leads-desk · foldrun");
  assert.equal(tabTitle(run("failed", [step("failed")], { stopRequested: true })), "■ stopped · step 1/1 · leads-desk · foldrun");
  assert.equal(tabTitle(run("queued", [step("pending"), step("pending")])), "○ queued · leads-desk · foldrun");
});

// The browser's side of the wire, as the spec describes it: a frame ends at
// a blank line, `data:` lines join with newlines, unknown fields are dropped.
function parseSse(frame: string): { event?: string; data: string } {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "") break;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return { event, data: data.join("\n") };
}

test("a pretty-printed run record survives the wire", () => {
  const record = JSON.stringify(run("running", [step("running", 2)]), null, 2);
  assert.ok(record.includes("\n"), "the record under test has newlines, as the runner writes it");
  const got = parseSse(sseFrame("run", record));
  assert.equal(got.event, "run");
  assert.deepEqual(JSON.parse(got.data), JSON.parse(record));
});

test("a one-line payload is one data line", () => {
  assert.equal(sseFrame("done", '{"status":"completed"}'), 'event: done\ndata: {"status":"completed"}\n\n');
});

test("eventRelease: the URL a wait: event step printed when it parked", () => {
  const parked = (text: string, event = true) =>
    ({ ...step("awaiting-approval"), ...(event ? { waitFor: "event" } : {}), events: [{ t: "", type: "info", text }] }) as StepRecord;
  const abs = "https://dev.foldrun.io/api/events/acme/desk/run-1?token=abc";
  assert.deepEqual(eventRelease(parked(`waiting for an external event — release it with POST ${abs}`)), {
    url: abs,
    path: "/api/events/acme/desk/run-1?token=abc",
  });
  const rel = "/api/events/acme/desk/run-1?token=abc";
  assert.deepEqual(eventRelease(parked(`waiting for an external event — release it with POST ${rel}`)), { url: rel, path: rel });
  // Not an event wait, or the line is gone: nothing to show.
  assert.equal(eventRelease(parked(`release it with POST ${rel}`, false)), null);
  assert.equal(eventRelease(parked("waiting for approval before running")), null);
});

test("eventBody: JSON when it parses, text otherwise, and a broken object is caught", () => {
  assert.deepEqual(eventBody(""), { body: "", contentType: "text/plain", error: null });
  assert.deepEqual(eventBody(' { "paid": true } '), { body: '{"paid":true}', contentType: "application/json", error: null });
  assert.deepEqual(eventBody("done"), { body: "done", contentType: "text/plain", error: null });
  const broken = eventBody('{ "paid": true ');
  assert.equal(broken.contentType, "text/plain");
  assert.match(broken.error ?? "", /^not valid JSON/);
});
