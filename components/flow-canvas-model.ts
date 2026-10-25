// The flow canvas, as data — no React, no DOM, so every rule here is testable
// with node --test and the component only draws what this returns.
//
// Three jobs:
//
//   buildCanvas     a parsed flow + the agents it names → positioned nodes and
//                   edges. Layout is DERIVED, every render, from the markdown:
//                   left to right, one column per group, parallel steps
//                   stacked. Nothing is saved but the markdown itself, so the
//                   picture can never disagree with the file.
//   dropTarget /    where a dragged node or palette block would land, and
//   planMove        whether moving a step there is a move the grammar allows.
//
// What each gesture WRITES — a pattern into a flow file, a team change into
// an agent file — is core's (src/flow-patterns.ts), shared with the CLI, and
// runs on the server: core's parser reads the disk, so a client component
// cannot import it.

import type { FlowStep } from "@/lib/store";
import { joinGroup, splitToRail, type Groups } from "@/lib/arrange.ts";
import { limitsChip } from "./step-limits-model.ts";

// ---------- inputs ----------

/** What the canvas needs of an agent file — a slice of core's AgentInfo. */
export interface AgentTeam {
  name: string;
  description: string;
  model: string;
  effort: string | null;
  tools: string[];
  consults: string[];
  subagents: string[];
}

export interface CanvasWarning {
  step: number | null;
  message: string;
  level?: "error" | "warn";
}

export interface CanvasInput {
  trigger: string;
  schedule?: string | null;
  steps: FlowStep[];
  agents: Record<string, AgentTeam>;
  flows: string[];
  warnings?: CanvasWarning[];
  /** Columns drawn as one summary node — a view choice, never written:
   *  the group numbers (as in the file) of parallel groups folded shut. */
  collapsed?: number[];
}

// ---------- geometry ----------

export const TRIGGER_W = 150;
export const TRIGGER_H = 56;
export const NODE_W = 248;
export const COL_GAP = 128;
export const TOP = 64; // room above the first row for loop back-edges
export const LEFT = 16;
/** The team hangs under its step as a tree: a spine down the left, one
 *  child per row, indented — so no edge crosses another child. */
export const CHILD_INDENT = 40;
export const CHILD_W = NODE_W - CHILD_INDENT;
export const CHILD_H = 28;
const CHILD_ROW_GAP = 8;
const CHILD_DROP = 14; // from the step's bottom to the first child
const STACK_GAP = 32; // between parallel steps in one column

export interface Chip {
  label: string;
  tone: "default" | "warning" | "info" | "success" | "error";
  title?: string;
}

export type StepNodeData = {
  index: number;
  group: number;
  column: number;
  step: FlowStep;
  agent: AgentTeam | null;
  /** The model this step runs on: the step's own, else the agent's. */
  model: string | null;
  chips: Chip[];
  problems: { message: string; level: "error" | "warn" }[];
  mayAsk: boolean;
  toolCount: number;
  missing: boolean;
  fanOut: boolean;
};

export type SummaryNodeData = {
  group: number;
  column: number;
  /** The folded steps' indices, in file order. */
  steps: number[];
  names: string[];
  errors: number;
};

export const SUMMARY_H = 92;

export type CanvasNode =
  | { id: string; kind: "trigger"; x: number; y: number; w: number; h: number; data: { trigger: string; schedule: string | null } }
  | { id: string; kind: "summary"; x: number; y: number; w: number; h: number; data: SummaryNodeData }
  | { id: string; kind: "step"; x: number; y: number; w: number; h: number; data: StepNodeData }
  | {
      id: string;
      kind: "sub" | "consult" | "rescuer";
      x: number;
      y: number;
      w: number;
      h: number;
      data: { name: string; parent: number; owner: string; missing: boolean; problem: string | null };
    };

export type EdgeKind = "seq" | "case" | "else" | "loop" | "onfail" | "delegate" | "consult";

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

export interface CanvasColumn {
  column: number;
  /** The group number as written in the file. */
  group: number;
  x: number;
  w: number;
  /** Step indices, in file order. */
  steps: number[];
}

export interface CanvasLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  columns: CanvasColumn[];
  width: number;
  height: number;
}

export const stepId = (i: number) => `step-${i}`;
export const summaryId = (column: number) => `summary-${column}`;

// ---------- chips ----------

/** Seconds as the flow file would write them. */
export function humanWait(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The compact options a node shows. Routing (case/else) and the loop are
 *  drawn as edges, not chips, so they are not repeated here. */
export function stepChips(s: FlowStep): Chip[] {
  const out: Chip[] = [];
  if (s.approve) out.push({ label: "needs approval", tone: "warning" });
  if (s.optional) out.push({ label: "optional", tone: "default" });
  if (s.ask) out.push({ label: `asks: ${clip(s.ask, 18)}`, tone: "warning", title: s.ask });
  if (s.waitFor === "event") out.push({ label: "wait: event", tone: "info" });
  else if (s.waitSecs != null) out.push({ label: `wait ${humanWait(s.waitSecs)}`, tone: "info" });
  if (s.when) out.push({ label: `when: ${clip(s.when, 16)}`, tone: "info", title: s.when });
  if (s.each) {
    const what = s.each === "rows" ? `rows${s.eachPath ? ` of ${clip(s.eachPath, 14)}` : ""}` : s.each;
    out.push({ label: `each: ${what}${s.max != null ? ` ×${s.max}` : ""}`, tone: "info", title: s.eachPath });
  }
  if (s.verify) out.push({ label: "verify", tone: "success", title: s.verify });
  if (s.retry != null && s.retry > 0) out.push({ label: `retry ×${s.retry}`, tone: "default" });
  if (s.timeout != null) out.push({ label: `timeout ${humanWait(s.timeout)}`, tone: "default" });
  if (s.delegate?.length) out.push({ label: `delegate: ${clip(s.delegate.join(", "), 18)}`, tone: "info", title: s.delegate.join(", ") });
  if (s.output === "json") out.push({ label: "output: json", tone: "default" });
  const limits = limitsChip(s.limits);
  if (limits) out.push({ label: limits, tone: "default", title: Object.entries(s.limits ?? {}).map(([k, n]) => `${k}: ${n}`).join(", ") });
  return out;
}

// ---------- validation ----------

/** What `foldrun check` and the runner say about an agent's team: a
 *  sub-agent that is not in the workspace, is the agent itself, or has no
 *  description (the model picks a sub-agent BY its description, so the
 *  runner refuses one without); a consult that names nobody. */
export function teamProblems(agent: AgentTeam, agents: Record<string, AgentTeam>): { name: string; kind: "sub" | "consult"; message: string }[] {
  const out: { name: string; kind: "sub" | "consult"; message: string }[] = [];
  for (const sub of agent.subagents) {
    const a = agents[sub];
    if (!a) out.push({ name: sub, kind: "sub", message: `subagents: "${sub}" is not an agent in this workspace` });
    else if (sub === agent.name) out.push({ name: sub, kind: "sub", message: `subagents: "${sub}" is this agent itself` });
    else if (!String(a.description ?? "").trim()) out.push({ name: sub, kind: "sub", message: `subagents: "${sub}" has no description — the model picks a sub-agent by it` });
  }
  for (const c of agent.consults) {
    if (!agents[c]) out.push({ name: c, kind: "consult", message: `agents: "${c}" is not an agent in this workspace` });
  }
  return out;
}

// ---------- layout ----------

/** Rough rendered width of a chip, in px — for row wrapping, not pixels. */
const chipWidth = (label: string) => Math.ceil(label.length * 6.1) + 14;

function chipRows(chips: Chip[], inner: number): number {
  if (!chips.length) return 0;
  let rows = 1;
  let used = 0;
  for (const c of chips) {
    const w = Math.min(chipWidth(c.label), inner);
    if (used && used + 4 + w > inner) {
      rows++;
      used = w;
    } else used += (used ? 4 : 0) + w;
  }
  return rows;
}

/** The height a step node is drawn at. The node renders at exactly this
 *  height, so the stacking below never overlaps. */
export function stepHeight(d: Pick<StepNodeData, "chips" | "problems" | "step" | "agent">): number {
  let h = 12 + 24; // padding + header
  if (d.step.instruction) h += 32; // two clamped lines
  const rows = chipRows(d.chips, NODE_W - 20);
  if (rows) h += rows * 22 + 4;
  if (!d.step.subflow) h += 26; // team line: tools, may-ask toggle
  if (!d.step.subflow) h += 28; // the docks
  h += d.problems.length * 18;
  return h + 8;
}

export function buildCanvas(input: CanvasInput): CanvasLayout {
  const { steps, agents } = input;
  const flowSet = new Set(input.flows);
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // Groups in file order, as the parser sorted them.
  const byGroup = new Map<number, number[]>();
  steps.forEach((s, i) => byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), i]));
  const groups = [...byGroup.entries()].sort((a, b) => a[0] - b[0]);

  const triggerX = LEFT;
  nodes.push({
    id: "trigger",
    kind: "trigger",
    x: triggerX,
    y: TOP,
    w: TRIGGER_W,
    h: TRIGGER_H,
    data: { trigger: input.trigger || "manual", schedule: input.schedule ?? null },
  });

  const columns: CanvasColumn[] = [];
  let maxY = TOP + TRIGGER_H;
  const firstX = triggerX + TRIGGER_W + COL_GAP;
  const folded = new Set(input.collapsed ?? []);
  // The node a step is drawn as: its own, or its folded column's summary.
  const nodeOf = new Map<number, string>();
  groups.forEach(([group, idx], column) => {
    for (const i of idx) nodeOf.set(i, folded.has(group) && idx.length > 1 ? summaryId(column) : stepId(i));
  });
  const idOf = (i: number) => nodeOf.get(i) ?? stepId(i);

  groups.forEach(([group, idx], column) => {
    const x = firstX + column * (NODE_W + COL_GAP);
    columns.push({ column, group, x, w: NODE_W, steps: idx });
    if (folded.has(group) && idx.length > 1) {
      const errors = idx.reduce(
        (n, i) =>
          n +
          (input.warnings ?? []).filter((w) => w.step === i && w.level === "error").length +
          (steps[i].problems?.length ?? 0) +
          (steps[i].subflow ? (flowSet.has(steps[i].subflow!) ? 0 : 1) : agents[steps[i].agent] ? 0 : 1),
        0,
      );
      nodes.push({
        id: summaryId(column),
        kind: "summary",
        x,
        y: TOP,
        w: NODE_W,
        h: SUMMARY_H,
        data: { group, column, steps: idx, names: idx.map((i) => steps[i].subflow ? `flow: ${steps[i].subflow}` : steps[i].agent), errors },
      });
      maxY = Math.max(maxY, TOP + SUMMARY_H);
      return;
    }
    let y = TOP;
    for (const i of idx) {
      const s = steps[i];
      const agent = s.subflow ? null : (agents[s.agent] ?? null);
      const missing = s.subflow ? !flowSet.has(s.subflow) : !agent;
      const problems: StepNodeData["problems"] = [];
      if (s.subflow && missing) problems.push({ message: `[[flow:${s.subflow}]] is not a flow in this workspace`, level: "error" });
      for (const w of input.warnings ?? []) {
        if (w.step === i) problems.push({ message: w.message, level: w.level === "error" || /is not an agent|as a sentence/.test(w.message) ? "error" : "warn" });
      }
      for (const p of s.problems ?? []) {
        if (!problems.some((q) => q.message.includes(p))) problems.push({ message: p, level: "error" });
      }
      const team = agent ? teamProblems(agent, agents) : [];
      for (const t of team) problems.push({ message: t.message, level: "error" });
      const data: StepNodeData = {
        index: i,
        group,
        column,
        step: s,
        agent,
        model: s.model ?? agent?.model ?? null,
        chips: stepChips(s),
        problems,
        mayAsk: !!agent?.tools.includes("ask"),
        toolCount: agent?.tools.length ?? 0,
        missing,
        fanOut: !!s.each,
      };
      const h = stepHeight(data);
      const id = stepId(i);
      nodes.push({ id, kind: "step", x, y, w: NODE_W, h, data });
      y += h;

      // The agent's team, hung below the step it serves.
      const children: { kind: "sub" | "consult" | "rescuer"; name: string }[] = [];
      if (agent) {
        for (const n of agent.subagents) children.push({ kind: "sub", name: n });
        for (const n of agent.consults) children.push({ kind: "consult", name: n });
      }
      if (s.onFail) children.push({ kind: "rescuer", name: s.onFail });
      if (children.length) {
        y += CHILD_DROP;
        children.forEach((c, k) => {
          const cx = x + CHILD_INDENT;
          const cy = y + k * (CHILD_H + CHILD_ROW_GAP);
          const cid = `${id}:${c.kind}:${c.name}`;
          const problem = team.find((t) => t.name === c.name && (c.kind === "sub" ? t.kind === "sub" : t.kind === "consult"))?.message ?? null;
          nodes.push({
            id: cid,
            kind: c.kind,
            x: cx,
            y: cy,
            w: CHILD_W,
            h: CHILD_H,
            data: { name: c.name, parent: i, owner: s.agent, missing: !agents[c.name], problem: c.kind === "rescuer" ? null : problem },
          });
          edges.push({
            id: `e:${cid}`,
            source: id,
            target: cid,
            kind: c.kind === "sub" ? "delegate" : c.kind === "consult" ? "consult" : "onfail",
            label: c.kind === "sub" ? "sub-agent" : c.kind === "consult" ? "consults" : "on fail",
          });
        });
        y += children.length * (CHILD_H + CHILD_ROW_GAP) - CHILD_ROW_GAP;
      }
      y += STACK_GAP;
    }
    maxY = Math.max(maxY, y - STACK_GAP);
  });

  // Sequence edges: the trigger feeds the first column; every column feeds
  // the next. A routed step's incoming edges carry its case, once.
  const seen = new Set<string>();
  groups.forEach(([, idx], column) => {
    const sources = column === 0 ? ["trigger"] : [...new Set(groups[column - 1][1].map(idOf))];
    for (const i of idx) {
      const s = steps[i];
      const me = idOf(i);
      const summary = me !== stepId(i);
      const kind: EdgeKind = summary ? "seq" : s.case ? "case" : s.else ? "else" : "seq";
      sources.forEach((src, k) => {
        const id = `seq:${src}->${me}`;
        if (seen.has(id)) return;
        seen.add(id);
        edges.push({
          id,
          source: src,
          target: me,
          kind,
          label: k === 0 && !summary ? (s.case ? `case: ${clip(s.case, 16)}` : s.else ? "else" : undefined) : undefined,
        });
      });
      // The evaluator loop winds back to the previous group.
      if (s.loop != null) {
        const back = column > 0 ? idOf(groups[column - 1][1][0]) : me;
        const id = `loop:${me}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({
          id,
          source: me,
          target: back,
          kind: "loop",
          label: `loop ×${s.loop}${s.until ? ` until ${clip(s.until, 14)}` : ""}`,
        });
      }
    }
  });

  const width = groups.length ? firstX + groups.length * (NODE_W + COL_GAP) - COL_GAP + LEFT : firstX + LEFT;
  return { nodes, edges, columns, width, height: maxY + 24 };
}

// ---------- dropping ----------

export type DropTarget = { kind: "column"; column: number } | { kind: "gap"; rail: number };

/**
 * Where an x position on the canvas lands. Inside a column is "run in
 * parallel with that group"; between two columns (or before the first,
 * after the last) is "its own step here". Only x matters: a column is
 * one group whatever its height.
 */
export function dropTarget(columns: CanvasColumn[], x: number): DropTarget | null {
  if (!columns.length) return x >= LEFT + TRIGGER_W ? { kind: "gap", rail: 0 } : null;
  if (x < LEFT + TRIGGER_W) return null; // on the trigger
  for (const c of columns) {
    if (x >= c.x && x <= c.x + c.w) return { kind: "column", column: c.column };
  }
  const rail = columns.filter((c) => c.x + c.w < x).length;
  return { kind: "gap", rail };
}

/** Words for a drop target — what releasing here will do. */
export function describeDrop(t: DropTarget, columns: number): string {
  if (t.kind === "column") return `run in parallel with step ${t.column + 1}`;
  if (t.rail === 0) return "run first";
  if (t.rail >= columns) return "run last";
  return `run between step ${t.rail} and step ${t.rail + 1}`;
}

export function groupsOf(steps: FlowStep[]): Groups {
  const map = new Map<number, number[]>();
  steps.forEach((s, i) => map.set(s.group, [...(map.get(s.group) ?? []), i]));
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Options that read the previous group's result, so cannot run first. */
export function needsPrevious(s: FlowStep): string | null {
  if (s.case) return "case: routes on the step before it";
  if (s.else) return "else: is the route when no case: before it matched";
  if (s.when && !/^rows of /.test(s.when)) return "when: reads the step before it";
  if (s.loop != null) return "loop: winds back to the step before it";
  if (s.each === "lines" || s.each === "items") return `each: ${s.each} fans out over the step before it`;
  return null;
}

export type MovePlan = { groups: Groups } | { refused: string } | { noop: true };

/** Moving step `index` to `target`: the new arrangement, or why not. */
export function planMove(steps: FlowStep[], index: number, target: DropTarget): MovePlan {
  const groups = groupsOf(steps);
  if (target.kind === "column" && !groups[target.column]) return { refused: "no such column" };
  const next =
    target.kind === "column" ? joinGroup(groups, index, groups[target.column][0]) : splitToRail(groups, index, target.rail);
  if (JSON.stringify(next) === JSON.stringify(groups)) return { noop: true };
  // Only refuse what this move makes newly wrong.
  const before = new Set(groups[0] ?? []);
  for (const i of next[0] ?? []) {
    if (before.has(i)) continue;
    const why = needsPrevious(steps[i]);
    if (why) return { refused: `"${steps[i].subflow ?? steps[i].agent}" cannot run first — ${why}` };
  }
  return { groups: next };
}

/**
 * Moving several selected steps at once. Into a column: each joins that
 * column's group (selected steps already there stay). Onto a rail: the
 * selection becomes ONE new group there — they were picked together, so
 * they keep running together. Refused on the same rule as planMove.
 */
export function planMoveMany(steps: FlowStep[], indices: number[], target: DropTarget): MovePlan {
  const groups = groupsOf(steps);
  const picked = [...new Set(indices)].filter((i) => steps[i]).sort((a, b) => a - b);
  if (!picked.length) return { noop: true };
  if (picked.length === 1) return planMove(steps, picked[0], target);
  const pickedSet = new Set(picked);
  let next: Groups;
  if (target.kind === "column") {
    const col = groups[target.column];
    if (!col) return { refused: "no such column" };
    const kept = groups.map((g) => g.filter((i) => !pickedSet.has(i) || g === col));
    const at = kept.indexOf(kept[target.column]);
    kept[at] = [...kept[at], ...picked.filter((i) => !col.includes(i))];
    next = kept.filter((g) => g.length);
  } else {
    let rail = target.rail;
    const kept: Groups = [];
    groups.forEach((g, k) => {
      const rest = g.filter((i) => !pickedSet.has(i));
      if (rest.length) kept.push(rest);
      else if (k < target.rail) rail--;
    });
    rail = Math.max(0, Math.min(kept.length, rail));
    kept.splice(rail, 0, picked);
    next = kept;
  }
  if (JSON.stringify(next) === JSON.stringify(groups)) return { noop: true };
  const before = new Set(groups[0] ?? []);
  for (const i of next[0] ?? []) {
    if (before.has(i)) continue;
    const why = needsPrevious(steps[i]);
    if (why) return { refused: `"${steps[i].subflow ?? steps[i].agent}" cannot run first — ${why}` };
  }
  return { groups: next };
}

// ---------- copy ----------

/**
 * The markdown of steps, as the clipboard carries it: each step's line, the
 * indented lines directly under it, and every later option line before the
 * next step (the parser gives those to the step even after a blank line) —
 * the same lines core's removeStep deletes — in file order, so a paste keeps
 * which of them ran in parallel (their group numbers ride along; core's
 * pasteSteps renumbers them). `raw` is the flow file; a step's `line` is
 * 1-based in it.
 */
export function stepsMarkdown(raw: string, steps: FlowStep[], indices: number[]): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const starts = steps.map((s) => (s.line ?? 0) - 1).filter((l) => l >= 0);
  const out: string[] = [];
  const picked = [...new Set(indices)].filter((i) => steps[i]?.line).sort((a, b) => steps[a].line! - steps[b].line!);
  for (const i of picked) {
    const first = steps[i].line! - 1;
    const end = Math.min(lines.length, ...starts.filter((l) => l > first));
    out.push(lines[first]);
    let k = first + 1;
    while (k < end && /^\s+\S/.test(lines[k])) out.push(lines[k++]);
    for (; k < end; k++) {
      const opt = lines[k].match(/^(\s+)[a-z_-]+:/);
      if (!opt) continue;
      out.push(lines[k]);
      while (k + 1 < end && (lines[k + 1].match(/^(\s*)\S/)?.[1].length ?? 0) > opt[1].length) out.push(lines[++k]);
    }
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

/** Whether clipboard text looks like copied steps — a paste only offers
 *  itself for text whose first non-blank line is a step line. */
export function looksLikeSteps(text: string): boolean {
  const first = text.split("\n").find((l) => l.trim());
  return !!first && /^\s*\d+[?!]?\.?\s+\[\[(flow:)?[a-z0-9-]+\]\]/.test(first);
}

// ---------- undo ----------

/**
 * Undo and redo for canvas edits, as whole flow texts. Pure: every call
 * returns a new history. `record` is called with the text before an edit
 * and the text the server wrote; `undo`/`redo` say which text to write
 * back, and are refused when the file is no longer what we last wrote —
 * someone (another tab, the editor, a deploy) changed it, and stepping back
 * over their edit would silently discard it.
 */
export interface History {
  past: string[];
  future: string[];
  /** The text the server holds after our last write, or null before one. */
  wrote: string | null;
}
export const HISTORY_LIMIT = 50;
export const emptyHistory = (): History => ({ past: [], future: [], wrote: null });

export function recordEdit(h: History, before: string, after: string): History {
  if (before === after) return h;
  // `before` is not what we last wrote: someone changed the file between
  // our writes. Undo may go back to their text, never past it.
  const kept = h.wrote !== null && before !== h.wrote ? [] : h.past;
  const past = [...kept, before].slice(-HISTORY_LIMIT);
  return { past, future: [], wrote: after };
}

export type HistoryStep = { write: string; next: History } | { refused: string; next: History };

export function planUndo(h: History, current: string): HistoryStep {
  if (!h.past.length) return { refused: "nothing to undo", next: h };
  if (h.wrote !== null && current !== h.wrote) {
    return { refused: "the flow changed outside the canvas since your last edit — undo cleared", next: emptyHistory() };
  }
  const write = h.past[h.past.length - 1];
  return { write, next: { past: h.past.slice(0, -1), future: [...h.future, current].slice(-HISTORY_LIMIT), wrote: write } };
}

export function planRedo(h: History, current: string): HistoryStep {
  if (!h.future.length) return { refused: "nothing to redo", next: h };
  if (h.wrote !== null && current !== h.wrote) {
    return { refused: "the flow changed outside the canvas since your last edit — redo cleared", next: emptyHistory() };
  }
  const write = h.future[h.future.length - 1];
  return { write, next: { past: [...h.past, current].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1), wrote: write } };
}

// ---------- runs on the canvas ----------

/** What the overlay needs of a run's step — a slice of core's StepRecord,
 *  small enough to hand from the server page and to keep from a stream. */
export interface RunStepLite {
  agent: string;
  group: number;
  status: string; // StepRecord status, plus "expanded" for a fan-out template
  costUsd: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  item?: string;
  carriedFrom?: string;
  skipReason?: string;
  approvedAt?: string;
}

export interface RunLite {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  stopRequested?: boolean;
  test?: boolean;
  steps: RunStepLite[];
}

type StepRecordish = RunStepLite & { events?: { t: string }[] };

/** A run record (or a stream frame) cut down to what the overlay draws.
 *  A step with no start/finish stamp (older records) falls back to its
 *  first and last event. */
export function liteRun(r: {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  stopRequested?: boolean;
  test?: boolean;
  steps: StepRecordish[];
}): RunLite {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    ...(r.stopRequested ? { stopRequested: true } : {}),
    ...(r.test ? { test: true } : {}),
    steps: r.steps.map((s) => {
      const ev = s.events ?? [];
      const ran = s.status !== "pending" && s.status !== "skipped" && s.status !== "awaiting-approval";
      return {
        agent: s.agent,
        group: s.group,
        status: s.status,
        costUsd: s.costUsd ?? null,
        startedAt: s.startedAt ?? (ran && ev.length ? ev[0].t : null),
        finishedAt: s.finishedAt ?? (ran && s.status !== "running" && ev.length ? ev[ev.length - 1].t : null),
        ...(s.item ? { item: s.item } : {}),
        ...(s.carriedFrom ? { carriedFrom: s.carriedFrom } : {}),
        ...(s.skipReason ? { skipReason: s.skipReason } : {}),
        ...(s.approvedAt ? { approvedAt: s.approvedAt } : {}),
      };
    }),
  };
}

export type StepRunStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting-approval";

export interface StepRunView {
  status: StepRunStatus;
  /** Every record the node stands for: its own, its fan-out instances,
   *  a rescuer's and delegate picks'. Null when none has a cost yet. */
  costUsd: number | null;
  /** Earliest start and latest finish over those records; finishedAt is
   *  null while any of them still runs. */
  startedAt: string | null;
  finishedAt: string | null;
  /** 1-based index of the node's own record in run.steps — what
   *  POST runs/<id>/rerun { step } takes. */
  runStep: number;
  /** Fan-out instances, when the step expanded. */
  instances?: { total: number; done: number; failed: number };
  /** Other agents that ran under this node: an on-fail rescuer, delegate
   *  picks — or, for a [[flow:x]] step, the nested flow's agents. */
  extras: string[];
  carried: boolean;
  skipReason?: string;
}

const DONE = new Set(["completed", "failed", "skipped"]);

function aggregateStatus(own: StepRecordish, instances: StepRecordish[], extras: StepRecordish[]): StepRunStatus {
  const all = [...(instances.length ? instances : [own]), ...extras];
  if (all.some((s) => s.status === "running")) return "running";
  if (all.some((s) => s.status === "awaiting-approval")) return "awaiting-approval";
  if (!instances.length) {
    // A rescued step reads completed on its own record; trust it.
    const st = own.status as StepRunStatus;
    // A template that fanned out over nothing has no work to show.
    if ((own.status as string) === "expanded") return "skipped";
    if (st === "failed" && extras.some((s) => s.status === "pending")) return "running";
    return (["pending", "running", "completed", "failed", "skipped", "awaiting-approval"] as const).includes(st) ? st : "pending";
  }
  if (instances.some((s) => s.status === "failed")) return "failed";
  if (instances.every((s) => DONE.has(s.status))) return instances.some((s) => s.status === "completed") ? "completed" : "skipped";
  // Some instances done, the rest pending: the fan-out is under way.
  return instances.some((s) => DONE.has(s.status)) ? "running" : "pending";
}

/**
 * Which run record each flow step is — the overlay's one rule.
 *
 * A run's steps are not the flow's steps one for one: a fan-out template
 * becomes "expanded" with one instance per item behind it, an on-fail
 * rescuer and delegate picks are spliced in, a [[flow:x]] step is replaced
 * by the nested flow's steps, and groups are renumbered 1..n. So:
 *
 *   1. Records are ranked by their group (the run's own column order).
 *      Fan-out instances (`item` set) belong to the template of the same
 *      agent in the same group nearest before them in the record, and are
 *      matched with it, never alone.
 *   2. Flow steps are walked in column order (the canvas's order). Each
 *      agent step takes the first unused record with its agent, in a rank
 *      after every rank the previous columns took. Parallel steps of one
 *      column share that lower bound, so two of the same agent pair off
 *      in file order.
 *   3. A record left unmatched in a rank some step took is that step's
 *      extra (a rescuer or a delegate pick) — the nearest matched record
 *      before it in run order. One left in a rank nobody took belongs to
 *      the [[flow:x]] step whose columns surround it.
 *
 * A flow edited since the run simply matches less: a step with no record
 * is null, drawn without a status, and "Run from here" is off for it.
 */
export function runStepsToNodes(flowSteps: FlowStep[], runSteps: StepRecordish[]): (StepRunView | null)[] {
  const ranks = [...new Set(runSteps.map((s) => s.group))].sort((a, b) => a - b);
  const rankOf = (s: StepRecordish) => ranks.indexOf(s.group);
  const templates = runSteps.map((s, i) => ({ s, i })).filter((x) => !x.s.item);
  const used = new Set<number>();
  const own = new Map<number, number>(); // flow step → run index
  const columns = groupsOf(flowSteps);
  const matched = columns.map(() => ({ min: -1, hi: -1 }));
  const claim = (c: number, fi: number, hit: { s: StepRecordish; i: number }) => {
    used.add(hit.i);
    own.set(fi, hit.i);
    const m = matched[c];
    m.hi = Math.max(m.hi, rankOf(hit.s));
    m.min = m.min < 0 ? rankOf(hit.s) : Math.min(m.min, rankOf(hit.s));
  };
  // Front to back through the first [[flow:x]] column. The runner splices a
  // nested flow's steps in under their own names, and the canvas does not
  // know how many there are, so the columns after it match back to front:
  // the parent's last steps are the run's last records, and an agent the
  // nested flow also runs is left to the nested flow.
  const firstSub = columns.findIndex((col) => col.some((fi) => flowSteps[fi].subflow));
  const split = firstSub < 0 ? columns.length - 1 : firstSub;
  let floor = 0;
  for (let c = 0; c <= split; c++) {
    for (const fi of columns[c]) {
      if (flowSteps[fi].subflow) continue;
      const hit = templates.find((t) => !used.has(t.i) && t.s.agent === flowSteps[fi].agent && rankOf(t.s) >= floor);
      if (hit) claim(c, fi, hit);
    }
    if (matched[c].hi >= 0) floor = matched[c].hi + 1;
  }
  let ceiling = Infinity;
  for (let c = columns.length - 1; c > split; c--) {
    for (const fi of columns[c]) {
      const f = flowSteps[fi];
      if (f.subflow) continue;
      const hit = [...templates]
        .reverse()
        .find((t) => !used.has(t.i) && t.s.agent === f.agent && rankOf(t.s) >= floor && rankOf(t.s) <= ceiling);
      if (hit) claim(c, fi, hit);
    }
    if (matched[c].min >= 0) ceiling = matched[c].min - 1;
  }
  const colRank: { lo: number; min: number; hi: number }[] = [];
  let lo = 0;
  matched.forEach((m, c) => {
    colRank[c] = { lo, ...m };
    if (m.hi >= 0) lo = m.hi + 1;
  });

  const extras = new Map<number, number[]>(); // flow step → extra run indices
  const ownerOfRun = new Map<number, number>();
  for (const [fi, ri] of own) ownerOfRun.set(ri, fi);
  const takenRanks = new Set([...own.values()].map((ri) => rankOf(runSteps[ri])));
  for (const t of templates) {
    if (used.has(t.i)) continue;
    const r = rankOf(t.s);
    let owner: number | undefined;
    if (takenRanks.has(r)) {
      for (let j = t.i - 1; j >= 0 && owner === undefined; j--) {
        if (rankOf(runSteps[j]) === r && ownerOfRun.has(j)) owner = ownerOfRun.get(j);
      }
      if (owner === undefined) owner = [...own].find(([, ri]) => rankOf(runSteps[ri]) === r)?.[0];
    } else {
      // A nested flow's step: the [[flow:x]] whose column starts at or
      // before this rank, with no later column's match at or before it.
      columns.forEach((col, c) => {
        if (owner !== undefined) return;
        const sub = col.find((fi) => flowSteps[fi].subflow);
        if (sub === undefined || r < colRank[c].lo) return;
        const later = colRank.slice(c + 1).find((x) => x.min >= 0);
        if (!later || r < later.min) owner = sub;
      });
    }
    if (owner === undefined) continue;
    extras.set(owner, [...(extras.get(owner) ?? []), t.i]);
  }

  // Which template each fan-out instance belongs to. The runner splices a
  // template's instances in right after it, so two `each:` steps of one
  // agent in one group read: template, its items, template, its items.
  // Agent and group alone would give each of them both sets. An instance
  // with no template before it takes the next one (older records).
  const templateOf = new Map<number, number>(); // instance index → template index
  runSteps.forEach((s, j) => {
    if (!s.item) return;
    const same = (k: number) => !runSteps[k].item && runSteps[k].agent === s.agent && runSteps[k].group === s.group;
    let t = -1;
    for (let k = j - 1; k >= 0 && t < 0; k--) if (same(k)) t = k;
    for (let k = j + 1; k < runSteps.length && t < 0; k++) if (same(k)) t = k;
    if (t >= 0) templateOf.set(j, t);
  });

  return flowSteps.map((f, fi) => {
    const ri = own.get(fi);
    const extraIdx = extras.get(fi) ?? [];
    if (ri === undefined && !extraIdx.length) return null;
    const head = ri !== undefined ? runSteps[ri] : runSteps[extraIdx[0]];
    const headIdx = ri !== undefined ? ri : extraIdx[0];
    const rest = ri !== undefined ? extraIdx : extraIdx.slice(1);
    const instancesOf = (t: number) => runSteps.filter((_, j) => templateOf.get(j) === t);
    const instances = instancesOf(headIdx);
    const extraRecs = rest.map((k) => runSteps[k]);
    const extraInstances = rest.flatMap(instancesOf);
    const all = [head, ...instances, ...extraRecs, ...extraInstances];
    const costs = all.map((s) => s.costUsd).filter((c): c is number => typeof c === "number");
    const starts = all.map((s) => s.startedAt).filter((t): t is string => !!t).sort();
    const ends = all.map((s) => s.finishedAt).filter((t): t is string => !!t).sort();
    // For a subflow node every record is equal: aggregate over all of them.
    const status = ri === undefined
      ? aggregateStatus({ ...head, status: "pending" }, [head, ...extraRecs], extraInstances)
      : aggregateStatus(head, instances, [...extraRecs, ...extraInstances]);
    const live = status === "running" || all.some((s) => s.status === "running");
    return {
      status,
      costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      startedAt: starts[0] ?? null,
      finishedAt: live ? null : (ends[ends.length - 1] ?? null),
      runStep: headIdx + 1,
      ...(instances.length
        ? {
            instances: {
              total: instances.length,
              done: instances.filter((s) => s.status === "completed").length,
              failed: instances.filter((s) => s.status === "failed").length,
            },
          }
        : {}),
      extras: [...new Set(extraRecs.map((s) => s.agent))],
      carried: !!head.carriedFrom,
      ...(head.skipReason ? { skipReason: head.skipReason } : {}),
    };
  });
}

/** Seconds as a chip says them: 42s, 3m 05s, 1h 12m. */
export function humanSecs(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** A node's elapsed time: start to finish, or to `now` while it runs. */
export function stepElapsed(v: Pick<StepRunView, "startedAt" | "finishedAt" | "status">, now: number): number | null {
  if (!v.startedAt) return null;
  const end = v.finishedAt ? Date.parse(v.finishedAt) : v.status === "running" ? now : null;
  if (end == null) return null;
  return Math.max(0, (end - Date.parse(v.startedAt)) / 1000);
}

/** The run the canvas shows by default: the newest live one, else none
 *  (idle nodes then wear the newest finished run's chips). Newest first in. */
export function pickRuns<T extends { status: string }>(runs: T[]): { live: T | null; last: T | null } {
  const isLive = (s: string) => s === "queued" || s === "running" || s === "awaiting-approval";
  return { live: runs.find((r) => isLive(r.status)) ?? null, last: runs.find((r) => !isLive(r.status)) ?? null };
}

// ---------- the opening view ----------

/** The smallest zoom the canvas opens at when the whole flow must fit —
 *  a 5-step flow fits the canvas of a 1280px-wide page; past this it opens at the
 *  trigger and you pan. */
export const FIT_MIN = 0.4;
/** Room kept above the first row for a node's run strip. */
const STRIP_ROOM = 30;
/** The zoom buttons' column, with a margin. */
const MIN_PANE_H = 168;
const CONTROLS_W = 36;

/**
 * Where the canvas opens, from the pane's measured width: the zoom that
 * fits the whole flow across (never above 1, never below FIT_MIN), the
 * pan that puts it there, and the height the pane needs at that zoom — so
 * the card is as tall as the drawing and no taller. The band above the
 * first row is kept only when a loop arc is drawn there.
 */
export function fitViewport(layout: Pick<CanvasLayout, "width" | "height" | "edges">, paneWidth: number, pad = 12) {
  const loop = layout.edges.some((e) => e.kind === "loop");
  const top = loop ? 0 : Math.max(0, TOP - STRIP_ROOM);
  // The zoom buttons sit at the bottom right: the drawing keeps clear of them.
  const inner = Math.max(1, paneWidth - 2 * pad - CONTROLS_W);
  const zoom = Math.min(1, Math.max(FIT_MIN, inner / layout.width));
  const drawn = layout.width * zoom;
  const x = drawn <= inner ? pad + (inner - drawn) / 2 : pad;
  const tall = (layout.height - top) * zoom;
  // Never shorter than the zoom controls need; a short drawing is centred.
  const height = Math.round(Math.min(720, Math.max(MIN_PANE_H, tall + 2 * pad)));
  const y = Math.max(pad, (height - tall) / 2) - top * zoom;
  return { zoom, x, y, height, fits: drawn <= inner + 0.5 };
}
