// Observability across the whole account — the questions a person running
// twenty-odd desks asks that no single workspace's Observe page can answer:
//
//   is the platform healthy, or is it my flows?      → failures by cause
//   which desk is getting worse?                      → desks, this window vs last
//   what did it cost, and is that moving?             → spend, with its delta
//   what happened each day?                           → outcomes per day
//
// Pure: the page reduces every run once (server/run-lite.ts) and the
// per-workspace step/tool aggregation comes from platform/observe.ts; these
// functions only shape. tests/account-observe.test.ts pins the rules.
//
// Honesty carried over from observe.ts: a median over fewer than five runs is
// not shown (null), and a trend needs a previous window with runs in it.

import { isLive, isSuccess, needsAttention, tally } from "./outcome-model";
import { platformCause, type RunLite } from "./mission-model";

export const DAY = 86_400_000;
const MIN_SAMPLES = 5;

/** The runs that started inside [now - days, now), and the window before it. */
export function windows(runs: RunLite[], now: number, days: number): { cur: RunLite[]; prev: RunLite[] } {
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  const cur: RunLite[] = [];
  const prev: RunLite[] = [];
  for (const r of runs) {
    const t = Date.parse(r.startedAt);
    if (t >= start && t <= now) cur.push(r);
    else if (t >= prevStart && t < start) prev.push(r);
  }
  return { cur, prev };
}

// ---------------------------------------------------------------- causes

export type CauseKind = "platform" | "verify" | "timeout" | "blocked" | "bad" | "error" | "stopped";

export interface Cause {
  kind: CauseKind;
  /** Stable within a kind: the platform cause's key, else the kind. */
  key: string;
  label: string;
  /** Whether a desk edit could have caused it. */
  platform: boolean;
}

const CAUSE_LABEL: Record<Exclude<CauseKind, "platform">, string> = {
  verify: "A step's check did not pass",
  timeout: "A step ran out of time",
  blocked: "Finished, reported BLOCKED",
  bad: "Finished, reported BAD",
  error: "A step errored",
  stopped: "Stopped by a person",
};

/** Why a run did not succeed, in the words a person would use — or null
 *  when it did, or is still going. Platform causes are named by what broke
 *  (mission-model.platformCause), everything else by how the desk failed. */
export function causeOf(r: RunLite): Cause | null {
  if (isLive(r.outcome) || isSuccess(r.outcome)) return null;
  if (r.outcome === "stopped") return { kind: "stopped", key: "stopped", label: CAUSE_LABEL.stopped, platform: false };
  if (r.outcome === "blocked") return { kind: "blocked", key: "blocked", label: CAUSE_LABEL.blocked, platform: false };
  if (r.outcome === "bad") return { kind: "bad", key: "bad", label: CAUSE_LABEL.bad, platform: false };
  const reason = r.failure?.reason ?? "";
  const p = platformCause(reason);
  if (p) return { kind: "platform", key: p.key, label: p.label, platform: true };
  if (/^verify\b|verify `|→ no match|did not pass|judge:/i.test(reason)) return { kind: "verify", key: "verify", label: CAUSE_LABEL.verify, platform: false };
  if (/timed? ?out|timeout|deadline exceeded|exceeded its \d+s/i.test(reason)) return { kind: "timeout", key: "timeout", label: CAUSE_LABEL.timeout, platform: false };
  return { kind: "error", key: "error", label: CAUSE_LABEL.error, platform: false };
}

export interface CauseRow extends Cause {
  count: number;
  desks: string[];
  /** The newest run with this cause — the one to open. */
  newest: RunLite;
  /** A typical reason, from the newest run: what it actually said. */
  sample: string | null;
}

/** Every way runs went wrong in the window, platform causes first, then by
 *  how often. */
export function causes(runs: RunLite[]): CauseRow[] {
  const by = new Map<string, CauseRow & { _desks: Set<string> }>();
  for (const r of runs) {
    const c = causeOf(r);
    if (!c) continue;
    const id = `${c.kind}:${c.key}`;
    const row = by.get(id) ?? { ...c, count: 0, desks: [], newest: r, sample: null, _desks: new Set<string>() };
    row.count += 1;
    row._desks.add(r.workspace);
    if (r.startedAt >= row.newest.startedAt) row.newest = r;
    by.set(id, row);
  }
  return [...by.values()]
    .map(({ _desks, ...row }) => ({
      ...row,
      desks: [..._desks].sort(),
      sample: row.newest.failure ? `${row.newest.failure.agent}: ${row.newest.failure.reason}` : row.newest.headline,
    }))
    .sort((a, b) => Number(b.platform) - Number(a.platform) || b.count - a.count);
}

// ---------------------------------------------------------------- headline

export interface Kpis {
  runs: number;
  /** Runs with an outcome (not still going), stopped ones included. */
  finished: number;
  /** Ran to the end without failing. */
  succeeded: number;
  /** completed / finished; null with none finished. */
  rate: number | null;
  /** Same, for the window before — null when it had no finished runs. */
  prevRate: number | null;
  failed: number;
  /** Of `failed` + attention outcomes, the platform's. */
  platformFailures: number;
  deskFailures: number;
  spendUsd: number;
  prevSpendUsd: number;
  /** Median run length in seconds, over finished runs; null under 5. */
  medianSecs: number | null;
}

/** The shared completion rate (core outcome.ts tally), as a fraction:
 *  completed / (completed + failed), stopped runs left out. */
const rateOf = (runs: RunLite[]) => {
  const t = tally(runs.map((r) => r.outcome));
  return t.finished ? t.completed / t.finished : null;
};

export function median(values: number[]): number | null {
  if (values.length < MIN_SAMPLES) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const runSecs = (r: RunLite): number | null => {
  if (!r.finishedAt) return null;
  const ms = Date.parse(r.finishedAt) - Date.parse(r.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
};

export function kpis(cur: RunLite[], prev: RunLite[]): Kpis {
  const finished = cur.filter((r) => !isLive(r.outcome));
  const t = tally(cur.map((r) => r.outcome));
  let platformFailures = 0;
  let deskFailures = 0;
  for (const r of cur) {
    const c = causeOf(r);
    if (!c || c.kind === "stopped") continue;
    if (c.platform) platformFailures += 1;
    else deskFailures += 1;
  }
  return {
    runs: cur.length,
    // Not live: what the Runs tile calls finished (stopped included, so it
    // is never shown as going — Codex review). The rate's own denominator
    // (completed + failed) stays inside rateOf.
    finished: t.runs - t.live,
    succeeded: t.completed,
    rate: rateOf(cur),
    prevRate: rateOf(prev),
    failed: cur.filter((r) => r.outcome === "failed").length,
    platformFailures,
    deskFailures,
    spendUsd: cur.reduce((s, r) => s + r.costUsd, 0),
    prevSpendUsd: prev.reduce((s, r) => s + r.costUsd, 0),
    medianSecs: median(finished.map(runSecs).filter((v): v is number => v !== null)),
  };
}

// ---------------------------------------------------------------- per day

export interface DayBucket {
  /** YYYY-MM-DD in the report's timezone. */
  day: string;
  good: number;
  /** Finished but BLOCKED or BAD: ran, and said something is wrong. */
  attention: number;
  failed: number;
  /** Of `failed`, the platform's. */
  platform: number;
  other: number;
  spendUsd: number;
}

/** The calendar day an instant falls on in `tz` (IANA). */
export function dayIn(iso: string | number, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** One bucket per calendar day in the window, zero-filled — a quiet day is a
 *  gap, not a missing column. */
export function perDay(runs: RunLite[], now: number, days: number, tz: string): DayBucket[] {
  const out = new Map<string, DayBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const d = dayIn(now - i * DAY, tz);
    if (!out.has(d)) out.set(d, { day: d, good: 0, attention: 0, failed: 0, platform: 0, other: 0, spendUsd: 0 });
  }
  for (const r of runs) {
    const b = out.get(dayIn(r.startedAt, tz));
    if (!b) continue;
    b.spendUsd += r.costUsd;
    if (isSuccess(r.outcome)) b.good += 1;
    else if (r.outcome === "failed") {
      b.failed += 1;
      if (causeOf(r)?.platform) b.platform += 1;
    } else if (needsAttention(r.outcome)) b.attention += 1;
    else b.other += 1;
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The timezone most of the account's schedules run in — the one its
 *  people live in, so "Tuesday" means their Tuesday. UTC when none say. */
export function accountTimezone(zones: (string | null | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const z of zones) if (z) counts.set(z, (counts.get(z) ?? 0) + 1);
  let best = "UTC";
  let n = 0;
  for (const [z, c] of counts) {
    if (c > n || (c === n && z < best)) {
      best = z;
      n = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- desks

export interface DeskHealth {
  workspace: string;
  runs: number;
  rate: number | null;
  prevRate: number | null;
  /** Failed, BLOCKED or BAD runs in the window — the platform's excluded. */
  deskFailures: number;
  platformFailures: number;
  spendUsd: number;
  medianSecs: number | null;
  /** The flow with the most desk failures, and how many. */
  worst: { what: string; count: number } | null;
  /** The newest run that went wrong, to open. */
  lastBad: RunLite | null;
}

/** Every workspace, worst first: desk failures, then a falling success rate,
 *  then spend. A desk that did not run is listed last, not hidden. */
export function deskHealth(workspaces: string[], cur: RunLite[], prev: RunLite[]): DeskHealth[] {
  const group = (runs: RunLite[]) => {
    const m = new Map<string, RunLite[]>(workspaces.map((w) => [w, []]));
    for (const r of runs) m.get(r.workspace)?.push(r);
    return m;
  };
  const c = group(cur);
  const p = group(prev);
  const rows: DeskHealth[] = [];
  for (const w of workspaces) {
    const runs = c.get(w) ?? [];
    let deskFailures = 0;
    let platformFailures = 0;
    const perFlow = new Map<string, number>();
    let lastBad: RunLite | null = null;
    for (const r of runs) {
      const cause = causeOf(r);
      if (!cause || cause.kind === "stopped") continue;
      if (!lastBad || r.startedAt > lastBad.startedAt) lastBad = r;
      if (cause.platform) {
        platformFailures += 1;
        continue;
      }
      deskFailures += 1;
      perFlow.set(r.what, (perFlow.get(r.what) ?? 0) + 1);
    }
    const worstEntry = [...perFlow].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    rows.push({
      workspace: w,
      runs: runs.length,
      rate: rateOf(runs),
      prevRate: rateOf(p.get(w) ?? []),
      deskFailures,
      platformFailures,
      spendUsd: runs.reduce((s, r) => s + r.costUsd, 0),
      medianSecs: median(runs.map(runSecs).filter((v): v is number => v !== null)),
      worst: worstEntry ? { what: worstEntry[0], count: worstEntry[1] } : null,
      lastBad,
    });
  }
  const falling = (d: DeskHealth) => (d.rate !== null && d.prevRate !== null ? d.prevRate - d.rate : 0);
  return rows.sort(
    (a, b) =>
      Number(b.runs > 0) - Number(a.runs > 0) ||
      b.deskFailures - a.deskFailures ||
      falling(b) - falling(a) ||
      b.spendUsd - a.spendUsd ||
      a.workspace.localeCompare(b.workspace),
  );
}

// ---------------------------------------------------------------- agents & tools

/** The per-workspace aggregation's shapes, as much of them as this reads. */
export interface AgentIn {
  agent: string;
  steps: number;
  failed: number;
  retried: number;
  costUsd: number;
  /** What its steps were charged (FOL-54); absent from an older report. */
  chargedUsd?: number;
  seconds: { n: number; p50: number | null; p95: number | null; max: number | null };
}
export interface ToolIn {
  name: string;
  calls: number;
  errors: number;
  ms: { n: number; p50: number | null; p95: number | null; max: number | null };
}

export interface AgentRow extends AgentIn {
  workspace: string;
}
export interface ToolRow {
  name: string;
  calls: number;
  errors: number;
  /** Workspaces that called it — the blast radius. */
  workspaces: string[];
  /** The slowest p95 any workspace measured for it, ms; null if none did. */
  p95ms: number | null;
}

/** The agents worth looking at: those that failed or needed retries, most
 *  failures first; then the most expensive. At most `n`. */
export function agentsToWatch(per: { workspace: string; agents: AgentIn[] }[], n = 10): AgentRow[] {
  const all = per.flatMap((w) => w.agents.map((a) => ({ ...a, workspace: w.workspace })));
  return all
    .filter((a) => a.steps > 0)
    .sort((a, b) => b.failed - a.failed || b.retried - a.retried || (b.chargedUsd ?? b.costUsd) - (a.chargedUsd ?? a.costUsd))
    .slice(0, n);
}

/** Tools across the account, merged by name: errors first, then calls. */
export function toolsAcross(per: { workspace: string; tools: ToolIn[] }[], n = 10): ToolRow[] {
  const by = new Map<string, ToolRow & { _ws: Set<string> }>();
  for (const w of per) {
    for (const t of w.tools) {
      const row = by.get(t.name) ?? { name: t.name, calls: 0, errors: 0, workspaces: [], p95ms: null, _ws: new Set<string>() };
      row.calls += t.calls;
      row.errors += t.errors;
      row._ws.add(w.workspace);
      if (t.ms.p95 !== null) row.p95ms = Math.max(row.p95ms ?? 0, t.ms.p95);
      by.set(t.name, row);
    }
  }
  return [...by.values()]
    .map(({ _ws, ...t }) => ({ ...t, workspaces: [..._ws].sort() }))
    .filter((t) => t.calls > 0)
    .sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, n);
}
