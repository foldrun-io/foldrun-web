// The flow canvas: markdown → model (layout, drop targets, moves,
// validation), and the round trip every palette block makes — markdown →
// model → core's pattern edit → markdown → parse → model — so what the
// canvas draws after a drop is what the block promised. The edits themselves
// are core's, tested line by line in foldrun-core/tests/flow-patterns.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import matter from "gray-matter";
import { parseFlow, reorderFlowSteps } from "../../foldrun-core/src/store.ts";
import { applyPatternEdit, editFrontmatterList, type PatternEdit } from "../../foldrun-core/src/flow-patterns.ts";
import {
  buildCanvas,
  dropTarget,
  planMove,
  groupsOf,
  teamProblems,
  stepChips,
  type AgentTeam,
  type CanvasLayout,
} from "../components/flow-canvas-model.ts";

const FLOW = `---
name: desk
trigger: schedule
schedule: "0 9 * * 1"   # Monday
---

Prose above the steps stays.

1. [[triage]] — sort the inbox
2. [[bugs]] — fix it
   case: BUG
2. [[docs]] — write it up
   case: DOCS
2. [[general]] — handle the rest
   else: true
3. [[writer]] — draft the digest
4. [[reviewer]] — review it
   loop: 3
   until: APPROVED
5. [[publisher]] — one post per line
   each: lines
   max: 5
   on-fail: [[fixer]]
6!. [[sender]] — send it
   ask: Which list?

Notes below the last step are prose.
`;

const parse = (raw: string) => parseFlow("desk.md", raw);
const agent = (name: string, o: Partial<AgentTeam> = {}): AgentTeam => ({
  name,
  description: `${name} does things`,
  model: "default",
  effort: null,
  tools: [],
  consults: [],
  subagents: [],
  ...o,
});
const AGENTS: Record<string, AgentTeam> = Object.fromEntries(
  ["triage", "bugs", "docs", "general", "writer", "reviewer", "publisher", "fixer", "sender", "researcher", "editor"].map((n) => [n, agent(n)]),
);
AGENTS.writer = agent("writer", { subagents: ["researcher"], consults: ["editor"], tools: ["read", "ask"], model: "max" });

/** Everything outside the steps, byte for byte. */
const frame = (raw: string) => {
  const lines = raw.split("\n");
  return [lines.slice(0, 8).join("\n"), raw.slice(raw.indexOf("Notes below"))];
};

// ---------- markdown → model ----------

test("model: one column per group, parallel stacked, trigger first", () => {
  const f = parse(FLOW);
  const c = buildCanvas({ trigger: "schedule", schedule: "0 9 * * 1", steps: f.steps, agents: AGENTS, flows: [] });
  assert.equal(c.columns.length, 6);
  assert.deepEqual(c.columns.map((col) => col.steps.length), [1, 3, 1, 1, 1, 1]);
  const steps = c.nodes.filter((n) => n.kind === "step");
  // Same column, same x; stacked without overlap.
  const col2 = steps.filter((n) => n.kind === "step" && n.data.column === 1).sort((a, b) => a.y - b.y);
  assert.equal(new Set(col2.map((n) => n.x)).size, 1);
  for (let i = 1; i < col2.length; i++) assert.ok(col2[i].y >= col2[i - 1].y + col2[i - 1].h, "parallel steps overlap");
  assert.equal(c.nodes[0].kind, "trigger");
  assert.ok(c.edges.some((e) => e.source === "trigger" && e.target === "step-0"));
});

test("model: case/else labelled, loop is a back-edge, on-fail a rescuer, team hung below", () => {
  const f = parse(FLOW);
  const c = buildCanvas({ trigger: "manual", steps: f.steps, agents: AGENTS, flows: [] });
  const labels = c.edges.filter((e) => e.label).map((e) => `${e.kind}:${e.label}`);
  assert.ok(labels.includes("case:case: BUG"));
  assert.ok(labels.includes("case:case: DOCS"));
  assert.ok(labels.includes("else:else"));
  const loop = c.edges.find((e) => e.kind === "loop")!;
  assert.equal(loop.source, "step-5");
  assert.equal(loop.target, "step-4", "loop winds back to the previous group");
  assert.match(loop.label!, /loop ×3 until APPROVED/);
  const rescue = c.edges.find((e) => e.kind === "onfail")!;
  assert.equal(rescue.target, "step-6:rescuer:fixer");
  const writer = c.nodes.find((n) => n.id === "step-4")!;
  assert.equal(writer.kind, "step");
  if (writer.kind === "step") {
    assert.equal(writer.data.mayAsk, true);
    assert.equal(writer.data.model, "max");
    assert.equal(writer.data.toolCount, 2);
  }
  const sub = c.nodes.find((n) => n.id === "step-4:sub:researcher")!;
  assert.ok(sub.y > writer.y + writer.h, "sub-agent sits below its step");
  assert.deepEqual(
    c.edges.filter((e) => e.source === "step-4" && (e.kind === "delegate" || e.kind === "consult")).map((e) => `${e.kind}:${e.label}`),
    ["delegate:sub-agent", "consult:consults"],
  );
  const pub = c.nodes.find((n) => n.id === "step-6")!;
  if (pub.kind === "step") assert.equal(pub.data.fanOut, true);
  const send = c.nodes.find((n) => n.id === "step-7")!;
  if (send.kind === "step") assert.deepEqual(send.data.chips.map((x) => x.label), ["needs approval", "asks: Which list?"]);
});

test("model: nodes never overlap, a column's team included", () => {
  const f = parse(FLOW);
  const c = buildCanvas({ trigger: "manual", steps: f.steps, agents: AGENTS, flows: [] });
  const boxes = c.nodes;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
});

test("model: validation — missing agent, sub-agent without description or not here, prose verify", () => {
  const raw = "1. [[ghost]] — boo\n2. [[lead]] — lead\n   verify: the reply names every source it used\n";
  const agents = {
    lead: agent("lead", { subagents: ["quiet", "nobody", "lead"], consults: ["gone"] }),
    quiet: agent("quiet", { description: "" }),
  };
  assert.deepEqual(
    teamProblems(agents.lead, agents).map((p) => p.message),
    [
      'subagents: "quiet" has no description — the model picks a sub-agent by it',
      'subagents: "nobody" is not an agent in this workspace',
      'subagents: "lead" is this agent itself',
      'agents: "gone" is not an agent in this workspace',
    ],
  );
  const f = parse(raw);
  const c = buildCanvas({
    trigger: "manual",
    steps: f.steps,
    agents,
    flows: [],
    warnings: [
      { step: 0, message: "[[ghost]] is not an agent in this workspace" },
      { step: 1, message: "verify: reads as a sentence, so it will be run as a shell command" },
    ],
  });
  const n0 = c.nodes.find((n) => n.id === "step-0")!;
  const n1 = c.nodes.find((n) => n.id === "step-1")!;
  if (n0.kind === "step") {
    assert.equal(n0.data.missing, true);
    assert.equal(n0.data.problems[0].level, "error");
  }
  if (n1.kind === "step") assert.equal(n1.data.problems.filter((p) => p.level === "error").length, 5);
  const quiet = c.nodes.find((n) => n.id === "step-1:sub:quiet")!;
  if (quiet.kind === "sub") assert.match(quiet.data.problem!, /no description/);
});

test("model: a [[flow:x]] step is a subflow node and says when x is missing", () => {
  const f = parse("1. [[flow:digest]]\n2. [[flow:nope]]\n");
  const c = buildCanvas({ trigger: "manual", steps: f.steps, agents: {}, flows: ["digest"] });
  const [a, b] = c.nodes.filter((n) => n.kind === "step");
  if (a.kind === "step" && b.kind === "step") {
    assert.equal(a.data.step.subflow, "digest");
    assert.equal(a.data.missing, false);
    assert.equal(b.data.missing, true);
    assert.match(b.data.problems[0].message, /not a flow/);
  }
});

test("chips: every compact option", () => {
  const f = parse("1. [[a]]\n2?. [[b]] — x\n   wait: 30m\n   verify: judge: fine\n   retry: 2\n   when: GO\n   delegate: [[a]], [[c]]\n   each: rows of ../../storage/x.csv\n3. [[c]]\n   wait: event\n");
  assert.deepEqual(stepChips(f.steps[1]).map((c) => c.label), [
    "optional", "wait 30m", "when: GO", "each: rows of ../../storage…", "verify", "retry ×2", "delegate: a, c",
  ]);
  assert.deepEqual(stepChips(f.steps[2]).map((c) => c.label), ["wait: event"]);
});

// ---------- dropping and moving ----------

test("dropTarget: a column is parallel, between columns is its own step", () => {
  const c = buildCanvas({ trigger: "manual", steps: parse(FLOW).steps, agents: AGENTS, flows: [] });
  const [c0, c1] = c.columns;
  assert.deepEqual(dropTarget(c.columns, c0.x + 10), { kind: "column", column: 0 });
  assert.deepEqual(dropTarget(c.columns, c0.x + c0.w + 20), { kind: "gap", rail: 1 });
  assert.deepEqual(dropTarget(c.columns, c1.x + 1), { kind: "column", column: 1 });
  assert.deepEqual(dropTarget(c.columns, c0.x - 20), { kind: "gap", rail: 0 });
  assert.deepEqual(dropTarget(c.columns, 99999), { kind: "gap", rail: 6 });
  assert.equal(dropTarget(c.columns, 20), null, "the trigger is not a place for a step");
});

test("planMove: snaps to a valid arrangement, refuses what cannot run first, no-op is no-op", () => {
  const steps = parse(FLOW).steps;
  assert.deepEqual(planMove(steps, 0, { kind: "column", column: 0 }), { noop: true });
  const moved = planMove(steps, 4, { kind: "gap", rail: 1 });
  assert.ok("groups" in moved);
  if ("groups" in moved) assert.deepEqual(moved.groups, [[0], [4], [1, 2, 3], [5], [6], [7]]);
  const refused = planMove(steps, 1, { kind: "gap", rail: 0 });
  assert.ok("refused" in refused);
  if ("refused" in refused) assert.match(refused.refused, /cannot run first — case:/);
  const loopFirst = planMove(steps, 5, { kind: "column", column: 0 });
  assert.ok("refused" in loopFirst);
});

test("planMove round-trip: PATCH-groups markdown parses to the planned arrangement", () => {
  const steps = parse(FLOW).steps;
  const plan = planMove(steps, 7, { kind: "column", column: 3 });
  assert.ok("groups" in plan);
  if (!("groups" in plan)) return;
  const out = reorderFlowSteps(FLOW, plan.groups);
  const again = parse(out).steps;
  assert.deepEqual(groupsOf(again).map((g) => g.map((i) => again[i].agent)), plan.groups.map((g) => g.map((i) => steps[i].agent)));
});


// ---------- round trip: model → block → markdown → model ----------

const canvasOf = (raw: string, agents = AGENTS): CanvasLayout =>
  buildCanvas({ trigger: "manual", steps: parse(raw).steps, agents, flows: ["digest"] });

/** A drop on the canvas → the edit the canvas posts → the canvas drawn again. */
function drop(raw: string, edit: (c: CanvasLayout) => PatternEdit) {
  const before = canvasOf(raw);
  const out = applyPatternEdit(raw, edit(before));
  return { out, after: canvasOf(out) };
}
const stepNode = (c: CanvasLayout, agentName: string) => {
  const n = c.nodes.find((x) => x.kind === "step" && x.data.step.agent === agentName);
  assert.ok(n && n.kind === "step", `no node for ${agentName}`);
  return n;
};

test("round trip: Chain dropped in a gap is a new column there", () => {
  const { after } = drop(FLOW, (c) => {
    const t = dropTarget(c.columns, c.columns[2].x - 10);
    assert.deepEqual(t, { kind: "gap", rail: 2 });
    return { op: "insert", target: "editor", at: { rail: t!.kind === "gap" ? t!.rail : 0 } };
  });
  assert.equal(after.columns.length, 7);
  assert.equal(stepNode(after, "editor").data.column, 2);
});

test("round trip: Parallel dropped on a column stacks in it", () => {
  const { after } = drop(FLOW, (c) => ({ op: "insert", target: "editor", at: { column: c.columns[4].column } }));
  assert.equal(after.columns.length, 6);
  assert.equal(stepNode(after, "editor").data.column, 4);
  assert.equal(stepNode(after, "editor").x, stepNode(after, "publisher").x);
});

test("round trip: Run another flow draws a subflow node", () => {
  const { after } = drop(FLOW, () => ({ op: "insert", target: "digest", subflow: true, at: { rail: 6 } }));
  const n = after.nodes.find((x) => x.kind === "step" && x.data.step.subflow === "digest");
  assert.ok(n && n.kind === "step" && !n.data.missing);
});

test("round trip: Router draws labelled case/else edges from the triage step", () => {
  const { after } = drop("1. [[writer]]\n", () => ({
    op: "router", router: "triage", rail: 1, cases: [{ value: "BUG", target: "bugs" }], else: "general",
  }));
  const into = (a: string) => after.edges.filter((e) => e.target === stepNode(after, a).id);
  assert.deepEqual(into("bugs").map((e) => [e.source, e.kind, e.label]), [[stepNode(after, "triage").id, "case", "case: BUG"]]);
  assert.deepEqual(into("general").map((e) => [e.kind, e.label]), [["else", "else"]]);
});

test("round trip: Fan-out, Evaluator loop, Approval, Ask, Wait, Rescue show on the node", () => {
  const i = (raw: string, a: string) => stepNode(canvasOf(raw), a).data.index;
  let raw = FLOW;
  raw = applyPatternEdit(raw, { op: "options", step: i(raw, "writer"), set: { each: "items", max: "4" } });
  raw = applyPatternEdit(raw, { op: "options", step: i(raw, "writer"), set: { loop: "2", until: "DONE", verify: "judge: it is done" } });
  raw = applyPatternEdit(raw, { op: "approve", step: i(raw, "writer"), on: true });
  raw = applyPatternEdit(raw, { op: "options", step: i(raw, "writer"), set: { ask: "Which tone?" } });
  raw = applyPatternEdit(raw, { op: "options", step: i(raw, "writer"), set: { wait: "event" } });
  raw = applyPatternEdit(raw, { op: "options", step: i(raw, "writer"), set: { "on-fail": "fixer" } });
  const c = canvasOf(raw);
  const w = stepNode(c, "writer");
  assert.equal(w.data.fanOut, true);
  assert.deepEqual(w.data.chips.map((x) => x.label), ["needs approval", "asks: Which tone?", "wait: event", "each: items ×4", "verify"]);
  const loop = c.edges.find((e) => e.kind === "loop" && e.source === w.id)!;
  assert.equal(loop.label, "loop ×2 until DONE");
  assert.ok(c.edges.some((e) => e.kind === "onfail" && e.source === w.id && e.target === `${w.id}:rescuer:fixer`));
});

test("round trip: dock edits (sub-agent, consult, may ask) redraw the team", () => {
  const md = "---\nname: writer # lead\ntools: [read]\n---\n\nWrite.\n";
  let file = editFrontmatterList(md, "subagents", "researcher", "add");
  file = editFrontmatterList(file, "agents", "editor", "add");
  file = editFrontmatterList(file, "tools", "ask", "add");
  const front = matter(file).data;
  const writer: AgentTeam = { ...AGENTS.writer, tools: front.tools, subagents: front.subagents, consults: front.agents };
  const c = canvasOf("1. [[writer]]\n", { ...AGENTS, writer });
  assert.equal(stepNode(c, "writer").data.mayAsk, true);
  assert.deepEqual(c.edges.filter((e) => e.kind === "delegate" || e.kind === "consult").map((e) => e.target), [
    "step-0:sub:researcher", "step-0:consult:editor",
  ]);
  const removed = editFrontmatterList(file, "subagents", "researcher", "remove");
  assert.deepEqual(matter(removed).data.subagents, []);
  assert.equal(matter(removed).content, matter(md).content);
});
