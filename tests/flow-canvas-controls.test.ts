// The canvas controls' rules, apart from the browser: which run record each
// node is (runStepsToNodes), the undo ring, the clipboard's markdown, moving
// a selection, and which run the canvas watches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlow } from "../../foldrun-core/src/store.ts";
import {
  runStepsToNodes,
  liteRun,
  stepElapsed,
  humanSecs,
  pickRuns,
  recordEdit,
  planUndo,
  planRedo,
  emptyHistory,
  HISTORY_LIMIT,
  stepsMarkdown,
  looksLikeSteps,
  planMoveMany,
  groupsOf,
  type RunStepLite,
} from "../components/flow-canvas-model.ts";

const FLOW = `---
name: desk
---

1. [[triage]] — sort the inbox
2. [[bugs]] — fix it
   case: BUG
2. [[docs]] — write it up
   case: DOCS
3. [[writer]] — draft
4. [[publisher]] — one post per line
   each: lines
   on-fail: [[fixer]]
5!. [[sender]] — send it
`;
const steps = parseFlow("desk.md", FLOW).steps;

const rec = (agent: string, group: number, status: string, o: Partial<RunStepLite> = {}): RunStepLite => ({
  agent,
  group,
  status,
  costUsd: null,
  ...o,
});

// ---------- runStepsToNodes ----------

test("runStepsToNodes: one record per step maps by agent and group order", () => {
  const run = [
    rec("triage", 1, "completed", { costUsd: 0.01, startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:00:30Z" }),
    rec("bugs", 2, "completed", { costUsd: 0.02 }),
    rec("docs", 2, "skipped", { skipReason: "case: DOCS did not match" }),
    rec("writer", 3, "running", { startedAt: "2026-10-01T00:01:00Z" }),
    rec("publisher", 4, "pending"),
    rec("sender", 5, "pending"),
  ];
  const v = runStepsToNodes(steps, run);
  assert.deepEqual(v.map((x) => x?.status), ["completed", "completed", "skipped", "running", "pending", "pending"]);
  assert.equal(v[0]!.costUsd, 0.01);
  assert.equal(stepElapsed(v[0]!, 0), 30);
  assert.equal(stepElapsed(v[3]!, Date.parse("2026-10-01T00:01:05Z")), 5, "a running step ticks to now");
  assert.equal(v[2]!.skipReason, "case: DOCS did not match");
  assert.deepEqual(v.map((x) => x?.runStep), [1, 2, 3, 4, 5, 6], "rerun { step } is the 1-based record index");
});

test("runStepsToNodes: a fan-out's instances fold into its template; a rescuer is an extra", () => {
  const run = [
    rec("triage", 1, "completed"),
    rec("bugs", 2, "completed"),
    rec("docs", 2, "skipped"),
    rec("writer", 3, "completed"),
    rec("publisher", 4, "completed", { item: "a", costUsd: 0.1 }),
    rec("publisher", 4, "failed", { item: "b", costUsd: 0.2 }),
    rec("publisher", 4, "running", { item: "c", costUsd: 0.05, startedAt: "2026-10-01T00:00:00Z" }),
    rec("publisher", 4, "expanded"),
    rec("fixer", 4, "running", { costUsd: 0.3 }),
    rec("sender", 5, "pending"),
  ];
  const v = runStepsToNodes(steps, run);
  const pub = v[4]!;
  assert.equal(pub.status, "running");
  assert.deepEqual(pub.instances, { total: 3, done: 1, failed: 1 });
  assert.ok(Math.abs(pub.costUsd! - 0.65) < 1e-9, "instances + rescuer are all this node's spend");
  assert.deepEqual(pub.extras, ["fixer"]);
  assert.equal(pub.runStep, 8, "Run from here starts at the template, not an instance");
  assert.equal(pub.finishedAt, null, "still running");
  assert.equal(v[5]!.status, "pending");
});

test("runStepsToNodes: a fan-out whose instances all ended is failed if any failed, else completed", () => {
  const base = [rec("triage", 1, "completed"), rec("bugs", 2, "completed"), rec("docs", 2, "skipped"), rec("writer", 3, "completed")];
  const done = runStepsToNodes(steps, [...base, rec("publisher", 4, "completed", { item: "a" }), rec("publisher", 4, "expanded")]);
  assert.equal(done[4]!.status, "completed");
  const bad = runStepsToNodes(steps, [...base, rec("publisher", 4, "completed", { item: "a" }), rec("publisher", 4, "failed", { item: "b" }), rec("publisher", 4, "expanded")]);
  assert.equal(bad[4]!.status, "failed");
});

test("runStepsToNodes: two fan-outs of one agent in one group each count only their own instances", () => {
  // The runner splices each template's instances in right after it, so the
  // record is: template, its items, the next template, its items.
  const twin = parseFlow(
    "twin.md",
    `---\nname: twin\n---\n\n1. [[splitter]] — list\n2. [[worker]] — check A\n   each: lines\n2. [[worker]] — check B\n   each: lines\n`,
  ).steps;
  const run = [
    rec("splitter", 1, "completed"),
    rec("worker", 2, "skipped", { skipReason: "expanded into 2 items" }),
    rec("worker", 2, "completed", { item: "a", costUsd: 0.1 }),
    rec("worker", 2, "completed", { item: "b", costUsd: 0.1 }),
    rec("worker", 2, "skipped", { skipReason: "expanded into 1 item" }),
    rec("worker", 2, "failed", { item: "c", costUsd: 0.5 }),
  ];
  const v = runStepsToNodes(twin, run);
  assert.deepEqual(v[1]!.instances, { total: 2, done: 2, failed: 0 });
  assert.ok(Math.abs(v[1]!.costUsd! - 0.2) < 1e-9, `A's spend is its own: ${v[1]!.costUsd}`);
  assert.equal(v[1]!.status, "completed");
  assert.equal(v[1]!.runStep, 2);
  assert.deepEqual(v[2]!.instances, { total: 1, done: 0, failed: 1 });
  assert.ok(Math.abs(v[2]!.costUsd! - 0.5) < 1e-9, `B's spend is its own: ${v[2]!.costUsd}`);
  assert.equal(v[2]!.status, "failed");
  assert.equal(v[2]!.runStep, 5);
});

test("runStepsToNodes: awaiting approval, carried steps, groups renumbered by the runner", () => {
  const run = [
    rec("triage", 7, "completed", { carriedFrom: "run-old" }),
    rec("bugs", 9, "completed"),
    rec("docs", 9, "skipped"),
    rec("writer", 12, "completed"),
    rec("publisher", 13, "expanded"),
    rec("sender", 20, "awaiting-approval"),
  ];
  const v = runStepsToNodes(steps, run);
  assert.equal(v[0]!.carried, true);
  assert.equal(v[5]!.status, "awaiting-approval");
  assert.equal(v[4]!.status, "skipped", "an expanded template with no instances fanned out over nothing");
});

test("runStepsToNodes: a step the run never had is null; an edited flow matches what it can", () => {
  const run = [rec("triage", 1, "completed"), rec("writer", 2, "completed")];
  const v = runStepsToNodes(steps, run);
  assert.equal(v[0]!.status, "completed");
  assert.equal(v[1], null);
  assert.equal(v[2], null);
  assert.equal(v[3]!.status, "completed");
  assert.equal(v[5], null);
});

test("runStepsToNodes: the same agent twice pairs off in order, never backwards", () => {
  const twice = parseFlow("t.md", "1. [[writer]] — a\n2. [[editor]] — b\n3. [[writer]] — c\n").steps;
  const v = runStepsToNodes(twice, [rec("writer", 1, "completed"), rec("editor", 2, "completed"), rec("writer", 3, "running")]);
  assert.deepEqual(v.map((x) => x?.status), ["completed", "completed", "running"]);
  assert.deepEqual(v.map((x) => x?.runStep), [1, 2, 3]);
});

test("runStepsToNodes: a [[flow:x]] step owns the nested flow's records between its neighbours", () => {
  const sub = parseFlow("s.md", "1. [[triage]] — a\n2. [[flow:inner]]\n3. [[sender]] — c\n").steps;
  const run = [
    rec("triage", 1, "completed", { costUsd: 0.01 }),
    rec("fetch", 2, "completed", { costUsd: 0.1 }),
    rec("clean", 3, "running", { costUsd: 0.2 }),
    rec("sender", 4, "pending"),
  ];
  const v = runStepsToNodes(sub, run);
  assert.equal(v[1]!.status, "running");
  assert.ok(Math.abs(v[1]!.costUsd! - 0.3) < 1e-9);
  assert.deepEqual(v[1]!.extras, ["clean"]);
  assert.equal(v[2]!.status, "pending");
});

// The runner splices a nested flow's steps in under their own names
// (expandSubflows), so an agent the nested flow also runs appears twice.
// The step after [[flow:x]] claimed the nested one's record (audit,
// 2026-10-01): a column holding only the subflow never moved the floor.
test("runStepsToNodes: a step after [[flow:x]] is not matched to the nested flow's run of the same agent", () => {
  const f = parseFlow("p.md", "1. [[flow:sub]]\n2. [[writer]] — final\n").steps;
  const run = [
    rec("researcher", 1, "completed", { costUsd: 0.01 }),
    rec("writer", 2, "completed", { costUsd: 0.02 }), // inside sub
    rec("writer", 3, "running", { costUsd: 0.04 }), // the parent's step 2
  ];
  const v = runStepsToNodes(f, run);
  assert.equal(v[1]!.status, "running");
  assert.equal(v[1]!.costUsd, 0.04);
  assert.equal(v[0]!.status, "completed");
  assert.ok(Math.abs(v[0]!.costUsd! - 0.03) < 1e-9);
});

test("liteRun: start and finish fall back to the first and last event", () => {
  const r = liteRun({
    id: "r",
    status: "completed",
    startedAt: "x",
    finishedAt: "y",
    steps: [{ agent: "a", group: 1, status: "completed", costUsd: 1, events: [{ t: "2026-10-01T00:00:00Z" }, { t: "2026-10-01T00:02:00Z" }] }],
  });
  assert.equal(r.steps[0].startedAt, "2026-10-01T00:00:00Z");
  assert.equal(r.steps[0].finishedAt, "2026-10-01T00:02:00Z");
  assert.equal(humanSecs(125), "2m 05s");
  assert.equal(humanSecs(3 * 3600 + 120), "3h 02m");
});

test("pickRuns: the newest live run is watched; the newest finished one dresses idle nodes", () => {
  const runs = [{ id: "c", status: "queued" }, { id: "b", status: "failed" }, { id: "a", status: "completed" }];
  assert.deepEqual(pickRuns(runs), { live: runs[0], last: runs[1] });
  assert.deepEqual(pickRuns(runs.slice(1)), { live: null, last: runs[1] });
});

// ---------- undo ----------

test("undo/redo: whole texts, newest first, redo cleared by a new edit", () => {
  let h = emptyHistory();
  h = recordEdit(h, "A", "B");
  h = recordEdit(h, "B", "C");
  const u = planUndo(h, "C");
  assert.ok("write" in u && u.write === "B");
  h = u.next;
  const u2 = planUndo(h, "B");
  assert.ok("write" in u2 && u2.write === "A");
  h = u2.next;
  const r = planRedo(h, "A");
  assert.ok("write" in r && r.write === "B");
  h = r.next;
  h = recordEdit(h, "B", "D");
  assert.equal(h.future.length, 0, "a new edit forgets the redo stack");
  assert.ok("refused" in planRedo(h, "D"));
});

test("undo: refused and cleared when the file changed outside the canvas", () => {
  let h = recordEdit(emptyHistory(), "A", "B");
  const u = planUndo(h, "B-edited-elsewhere");
  assert.ok("refused" in u);
  assert.match(u.refused, /changed outside the canvas/);
  assert.deepEqual(u.next, emptyHistory());
  h = emptyHistory();
  assert.ok("refused" in planUndo(h, "x"));
});

test("undo: the ring keeps the last 50", () => {
  let h = emptyHistory();
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = recordEdit(h, `t${i}`, `t${i + 1}`);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[0], "t10");
});

// A colleague's edit landed between two of ours (audit, 2026-10-01): the
// second write's `before` is their file, not ours. Undoing past it would
// put our older text back over their change, so the older history goes.
test("undo: a write whose before is not what we last wrote keeps no history behind it", () => {
  let h = recordEdit(emptyHistory(), "A", "B");
  h = recordEdit(h, "X", "Y"); // someone turned B into X; our edit made Y
  const u = planUndo(h, "Y");
  assert.ok("write" in u && u.write === "X");
  assert.ok("refused" in planUndo(u.next, "X"), "a second undo would restore A over the colleague's X");
});

// ---------- copy ----------

test("stepsMarkdown: the step line and its options, in file order, prose left behind", () => {
  const raw = `${FLOW}\nNotes below.\n`;
  const s = parseFlow("desk.md", raw).steps;
  assert.equal(stepsMarkdown(raw, s, [4]), "4. [[publisher]] — one post per line\n   each: lines\n   on-fail: [[fixer]]\n");
  assert.equal(stepsMarkdown(raw, s, [5]), "5!. [[sender]] — send it\n");
  assert.equal(
    stepsMarkdown(raw, s, [2, 1]),
    "2. [[bugs]] — fix it\n   case: BUG\n2. [[docs]] — write it up\n   case: DOCS\n",
    "parallel steps keep their shared number",
  );
  assert.ok(looksLikeSteps(stepsMarkdown(raw, s, [0])));
  assert.ok(!looksLikeSteps("just some text"));
});

test("stepsMarkdown: options the parser gives a step after a blank line are copied too", () => {
  const raw = "1. [[x]]\n2. [[a]]\n\n   approve: true\n   verify: contains: done\n\nNotes.\n3. [[b]]\n";
  const s = parseFlow("t.md", raw).steps;
  assert.equal(stepsMarkdown(raw, s, [1]), "2. [[a]]\n   approve: true\n   verify: contains: done\n");
  assert.equal(stepsMarkdown(raw, s, [2]), "3. [[b]]\n");
});

// ---------- multi-select moves ----------

test("planMoveMany: a selection onto a rail becomes one group; into a column joins it", () => {
  const flat = parseFlow("f.md", "1. [[a]] — x\n2. [[b]] — x\n3. [[c]] — x\n4. [[d]] — x\n").steps;
  const rail = planMoveMany(flat, [1, 3], { kind: "gap", rail: 0 });
  assert.ok("groups" in rail);
  assert.deepEqual(rail.groups, [[1, 3], [0], [2]]);
  const col = planMoveMany(flat, [2, 3], { kind: "column", column: 0 });
  assert.ok("groups" in col);
  assert.deepEqual(col.groups, [[0, 2, 3], [1]]);
  assert.ok("noop" in planMoveMany(flat, [], { kind: "gap", rail: 0 }));
  assert.deepEqual(groupsOf(flat), [[0], [1], [2], [3]]);
});

test("planMoveMany: refuses to put a case: step first", () => {
  const r = planMoveMany(steps, [1, 2], { kind: "gap", rail: 0 });
  assert.ok("refused" in r);
  assert.match(r.refused, /cannot run first/);
});

// ---------- the opening view ----------

test("fitViewport: a 5-step flow fits a laptop-width pane; the pane is as tall as the drawing", async () => {
  const { buildCanvas, fitViewport, FIT_MIN } = await import("../components/flow-canvas-model.ts");
  const five = parseFlow("f.md", "1. [[a]] — x\n2. [[b]] — x\n3. [[c]] — x\n4. [[d]] — x\n5. [[e]] — x\n").steps;
  const layout = buildCanvas({ trigger: "manual", steps: five, agents: {}, flows: [] });
  const v = fitViewport(layout, 900);
  assert.ok(v.fits, `zoom ${v.zoom}`);
  for (const n of layout.nodes) {
    assert.ok(n.x * v.zoom + v.x >= 0 && (n.x + n.w) * v.zoom + v.x <= 900, `${n.id} outside the pane`);
    assert.ok(n.y * v.zoom + v.y >= 0 && (n.y + n.h) * v.zoom + v.y <= v.height, `${n.id} below the pane`);
  }
  assert.ok(v.height < 300, `no empty band: ${v.height}px`);
  // Too wide to fit readably: opens at FIT_MIN, from the left.
  const nine = parseFlow("n.md", Array.from({ length: 12 }, (_, i) => `${i + 1}. [[s${i}]] — x`).join("\n")).steps;
  const wide = fitViewport(buildCanvas({ trigger: "manual", steps: nine, agents: {}, flows: [] }), 1000);
  assert.equal(wide.zoom, FIT_MIN);
  assert.equal(wide.fits, false);
  assert.equal(wide.x, 12);
  // A narrow flow is never blown up past 1.
  const one = fitViewport(buildCanvas({ trigger: "manual", steps: five.slice(0, 1), agents: {}, flows: [] }), 1400);
  assert.equal(one.zoom, 1);
});

test("buildCanvas: a folded parallel group is one summary node, edges rerouted through it", async () => {
  const { buildCanvas } = await import("../components/flow-canvas-model.ts");
  const c = buildCanvas({ trigger: "manual", steps, agents: {}, flows: [], collapsed: [2] });
  const summary = c.nodes.find((n) => n.kind === "summary")!;
  assert.ok(summary && summary.kind === "summary");
  assert.deepEqual(summary.data.steps, [1, 2]);
  assert.deepEqual(summary.data.names, ["bugs", "docs"]);
  assert.ok(!c.nodes.some((n) => n.id === "step-1" || n.id === "step-2"));
  assert.ok(c.edges.some((e) => e.source === "step-0" && e.target === "summary-1"));
  assert.ok(c.edges.some((e) => e.source === "summary-1" && e.target === "step-3"));
  assert.equal(new Set(c.edges.map((e) => e.id)).size, c.edges.length, "no duplicate edges");
  // A one-step group never folds.
  const one = buildCanvas({ trigger: "manual", steps, agents: {}, flows: [], collapsed: [1] });
  assert.ok(!one.nodes.some((n) => n.kind === "summary"));
});
