// What a step received and what it produced, read from the run record.
//
// The runner builds a step's prompt from the record's own fields — the
// instruction, the nearest earlier group's results, the nearest earlier
// group's JSON, an event payload, an approver's note — and the answer comes
// back as `conclusion`, `data` and a cost line. None of that was on the run
// page as a fact: a reader had to scroll a trace to answer "what went in,
// what came out". These readers turn it into two short columns.
//
// They read the record the way the runner does (runner.ts: contextBefore,
// dataBefore, dataOf) and only the record, which is also what a resumed run
// rebuilds from. One departure, on purpose: an evaluator loop that winds
// back forgets the wound-back groups' results in memory; the record keeps
// them, so a looped step reads as fed by its latest upstream pass. Pure, so
// tests/step-io.test.ts pins the rules.

import type { StepRecord } from "@/lib/store";
// Pure, no node imports: this module is bundled into client components.
import { cacheHitRate, promptCacheNote, type TokenUsage } from "@/lib/tokens";

/** Why a step's prompt cache missed, for its "prompt cache" row — core's
 *  rule (tokens.ts), re-exported so the run page reads one module. */
export { promptCacheNote };

export interface StepRef {
  /** Position in run.steps — what the run page keys its cards by. */
  index: number;
  agent: string;
  item?: string;
}

export interface StepIn {
  instruction: string | null;
  /** The fan-out item this instance works on. */
  item: string | null;
  /** True for the first group: nothing ran before it, so nothing rode in. */
  first: boolean;
  /** The nearest earlier group that produced results — what arrived as
   *  <previous_step_results>. Null when no earlier group produced any. */
  results: { group: number; from: StepRef[] } | null;
  /** The nearest earlier group that returned `output: json` — what arrived
   *  as <previous_step_data>. */
  data: { group: number; from: StepRef[] } | null;
  /** What the outside world POSTed to release a `wait: event` step. */
  event: string | null;
  /** The gate's question, when it asked one. */
  ask: string | null;
  /** What the approver typed on the way through. */
  note: string | null;
  /** The run this step actually executed in, when it was carried into a
   *  re-run rather than run again. */
  carriedFrom: string | null;
}

interface Group {
  group: number;
  members: { index: number; step: StepRecord }[];
}

function orderedGroups(steps: StepRecord[]): Group[] {
  const by = new Map<number, Group>();
  steps.forEach((step, index) => {
    const g = by.get(step.group) ?? { group: step.group, members: [] };
    g.members.push({ index, step });
    by.set(step.group, g);
  });
  return [...by.values()].sort((a, b) => a.group - b.group);
}

const ref = (m: { index: number; step: StepRecord }): StepRef => ({
  index: m.index,
  agent: m.step.agent,
  ...(m.step.item ? { item: m.step.item } : {}),
});

export function stepInputs(steps: StepRecord[], index: number): StepIn {
  const step = steps[index];
  const groups = orderedGroups(steps);
  const gi = groups.findIndex((g) => g.group === step.group);

  // contextBefore: the nearest earlier group with a completed step that
  // said something.
  let results: StepIn["results"] = null;
  for (let i = gi - 1; i >= 0 && !results; i--) {
    const from = groups[i].members.filter((m) => m.step.status === "completed" && m.step.result);
    if (from.length) results = { group: groups[i].group, from: from.map(ref) };
  }
  // dataBefore: the nearest earlier group with a completed step that
  // returned JSON.
  let data: StepIn["data"] = null;
  for (let i = gi - 1; i >= 0 && !data; i--) {
    const from = groups[i].members.filter((m) => m.step.status === "completed" && m.step.data !== undefined);
    if (from.length) data = { group: groups[i].group, from: from.map(ref) };
  }

  return {
    instruction: step.instruction?.trim() || null,
    item: step.item ?? null,
    first: gi === 0,
    results,
    data,
    event: step.eventPayload ?? null,
    ask: step.ask ?? null,
    note: step.approvalNote ?? null,
    carriedFrom: step.carriedFrom ?? null,
  };
}

export interface StepOut {
  /** The step's one-line conclusion — the first line of its final answer. */
  headline: string | null;
  /** The whole final answer, when it says more than the headline. */
  answer: string | null;
  /** The parsed JSON an `output: json` step returned; undefined when none. */
  data: unknown;
  /** The last error the step logged — what "failed" actually means. */
  error: string | null;
  skipReason: string | null;
}

/** The first line of a reply, as a headline: markdown heading marks,
 *  bullets and emphasis stripped, long lines cut. */
export function headlineOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const clean = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .trim();
  if (!clean) return null;
  return clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
}

export function stepOutputs(step: StepRecord): StepOut {
  // The final text block is the answer. Records from before `conclusion`
  // existed still carry it as the last text event — the same block the
  // executor now stores — so they get the real conclusion too, and only a
  // record with no events at all falls back to the joined result, whose
  // first line is the model's opening narration.
  const lastText = [...step.events].reverse().find((e) => e.type === "text")?.text;
  const answer = (step.conclusion ?? lastText ?? step.result ?? "").trim() || null;
  const headline = headlineOf(answer);
  // The answer earns a second showing only when there is more of it than
  // the headline already said.
  const more = answer !== null && headline !== null && answer.replace(/\s+/g, " ").trim().length > headline.length + 8;
  const lastError = [...step.events].reverse().find((e) => e.type === "error")?.text ?? null;
  return {
    headline,
    answer: more ? answer : null,
    data: step.data,
    error: step.status === "failed" ? lastError : null,
    skipReason: step.skipReason ?? null,
  };
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "78% cached", or null when the counts cannot say (no input, or a step
 *  recorded before cache reads were counted apart, 18 Oct 2026). */
export function fmtCached(t: TokenUsage | null | undefined): string | null {
  const rate = cacheHitRate(t);
  return rate === null ? null : `${Math.round(rate * 100)}% cached`;
}

/** "12.4k in · 3.1k out · 78% cached" — `in` is every input token the model saw. */
export function fmtTokenLine(t: TokenUsage | null | undefined, rate: number | null = cacheHitRate(t)): string | null {
  if (!t) return null;
  const cached = rate === null ? null : `${Math.round(rate * 100)}% cached`;
  return `${fmtTokens(t.input)} in · ${fmtTokens(t.output)} out${cached ? ` · ${cached}` : ""}`;
}

const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The hover detail: fresh, read and written input apart. */
export function fmtTokenDetail(t: TokenUsage | null | undefined): string | null {
  if (!t) return null;
  if (t.cacheRead === undefined) return `${grouped(t.input)} in · ${grouped(t.output)} out`;
  const fresh = Math.max(0, t.input - t.cacheRead - (t.cacheWrite ?? 0));
  return (
    `${grouped(fresh)} fresh · ${grouped(t.cacheRead)} cache read · ` +
    `${grouped(t.cacheWrite ?? 0)} cache write · ${grouped(t.output)} out`
  );
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How many times a step reached for a path outside its workspace and was
 * refused. Each one is a wasted turn and a sign the agent does not know
 * where it is; a prompt that names the exact path brings it to zero (the
 * fix-flow investigator went from 15 to 0 on 2026-09-04). Read from the
 * events so old records count too. Pure, so the client run page can use it.
 */
export function deniedPaths(step: Pick<StepRecord, "events">): number {
  return (step.events ?? []).filter((e) => / was denied: /.test(e.text ?? "")).length;
}
