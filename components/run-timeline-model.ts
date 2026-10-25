// The timeline's reading of a run record — pure functions, no React, so the
// test suite can pin them and the component stays about drawing.

import type { StepRecord, RunEvent } from "@/lib/store";

// ---------- reading the record ----------

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

export const TERMINAL = new Set(["completed", "failed", "skipped"]);

/** One tool call as a span. `end` is null when the record has no completion
 *  event for it — pre-pairing records, or a tool still running. */
export interface ToolSpan {
  name: string;
  start: number;
  end: number | null;
  err: boolean;
}

/** Pair each tool call with its completion by the provider's id. Legacy
 *  events with no id stay unpaired ticks. */
export function toolSpans(step: Pick<StepRecord, "events">): ToolSpan[] {
  const open = new Map<string, ToolSpan>();
  const out: ToolSpan[] = [];
  for (const e of step.events) {
    if (e.type !== "tool") continue;
    const t = new Date(e.t).getTime();
    if (e.call && e.ms != null) {
      const span = open.get(e.call);
      if (span) {
        span.end = span.start + e.ms;
        span.err = Boolean(e.err);
        open.delete(e.call);
        continue;
      }
      // A completion whose call we never saw (redacted, truncated): still a fact.
      out.push({ name: e.text, start: t - e.ms, end: t, err: Boolean(e.err) });
      continue;
    }
    const span: ToolSpan = { name: e.text, start: t, end: null, err: false };
    if (e.call) open.set(e.call, span);
    out.push(span);
  }
  return out;
}

/** The trace shows one line per tool call, not two: completion events are
 *  folded into their call as a duration. Everything else passes through. */
export function traceEvents(step: Pick<StepRecord, "events">): (RunEvent & { durationMs?: number })[] {
  const byCall = new Map<string, RunEvent & { durationMs?: number }>();
  const out: (RunEvent & { durationMs?: number })[] = [];
  for (const e of step.events) {
    if (e.type === "tool" && e.call) {
      if (e.ms != null) {
        const start = byCall.get(e.call);
        if (start) {
          start.durationMs = e.ms;
          if (e.err) start.err = true;
          // Either half recorded means the call has content to show.
          if (e.captured) start.captured = true;
          continue;
        }
      }
      const copy = { ...e };
      byCall.set(e.call, copy);
      out.push(copy);
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

/** When a step ran, as best the record says. `null` when it has not begun. */
export function stepSpan(step: StepRecord, now: number): { start: number; end: number; live: boolean } | null {
  const first = step.events[0] ? new Date(step.events[0].t).getTime() : null;
  const last = step.events.at(-1) ? new Date(step.events.at(-1)!.t).getTime() : null;
  const start = ms(step.startedAt) ?? first;
  if (start == null) return null;
  const settled = TERMINAL.has(step.status);
  const end = ms(step.finishedAt) ?? (settled ? Math.max(last ?? start, start) : now);
  return { start, end: Math.max(end, start), live: !settled };
}

export function fmtDur(msTotal: number): string {
  const s = msTotal / 1000;
  if (s < 1) return `${s.toFixed(1)}s`;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  // Round to whole seconds first, so 659.6s is "11m 00s" and never "10m 60s".
  const whole = Math.round(s);
  const m = Math.floor(whole / 60);
  if (m < 60) return `${m}m ${String(whole - m * 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m - h * 60).padStart(2, "0")}m`;
}

/** Axis labels: a round tick reads "2m", not "2m 00s". */
export function fmtTick(msTotal: number): string {
  const s = Math.round(msTotal / 1000);
  if (s < 60) return `${s}s`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return fmtDur(msTotal);
}

// Axis ticks that land on round numbers, however long the run.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map((s) => s * 1000);
export function tickEvery(total: number): number {
  for (const step of TICK_STEPS) if (total / step <= 8) return step;
  return TICK_STEPS.at(-1)!;
}

// ---------- the window ----------
//
// A zoomed view of the run, as offsets from its start. `to: null` is the
// moving end: a window opened up to the right edge of a live run keeps its
// right edge on the clock, so "the last ten minutes" stays the last ten
// minutes as the run goes on. `null` for the window itself is the whole run.

export type Window = { from: number; to: number | null };
export const MIN_WINDOW = 2000; // two seconds; tighter than that is one tool call

/** The window's concrete edges against the run's current length. */
export function windowEdges(win: Window | null, total: number): { from: number; to: number } {
  if (!win) return { from: 0, to: total };
  const from = Math.min(Math.max(0, win.from), Math.max(0, total - MIN_WINDOW));
  const to = win.to == null ? total : Math.max(from + MIN_WINDOW, Math.min(total, win.to));
  return { from, to };
}

/**
 * Every way into a window ends here: clamp to the run, refuse a window
 * thinner than MIN_WINDOW, collapse one that covers everything back to
 * "no window", and pin one that reaches the end to the moving end.
 */
export function clampWindow(from: number, to: number, total: number): Window | null {
  let a = Math.max(0, from);
  let b = Math.min(total, to);
  if (b - a < MIN_WINDOW) {
    const c = (a + b) / 2;
    a = Math.max(0, c - MIN_WINDOW / 2);
    b = Math.min(total, a + MIN_WINDOW);
  }
  if (a <= 0 && b >= total) return null;
  return { from: a, to: b >= total - 1 ? null : b };
}

/** Zoom by a factor about a moment in the run, which stays where it is. */
export function zoomWindow(win: Window | null, total: number, factor: number, anchor: number): Window | null {
  const { from, to } = windowEdges(win, total);
  const len = (to - from) / factor;
  const frac = (anchor - from) / (to - from);
  return clampWindow(anchor - frac * len, anchor + (1 - frac) * len, total);
}

/** Slide the window by delta, keeping its length, stopping at either end. */
export function panWindow(win: Window | null, total: number, delta: number): Window | null {
  const { from, to } = windowEdges(win, total);
  const len = to - from;
  const next = Math.min(Math.max(0, from + delta), total - len);
  return clampWindow(next, next + len, total);
}

/**
 * Where a span sits inside the window, in percent of its width: null when
 * wholly outside, else clipped to the edges, floored at a visible width,
 * and — when the floor would push a sliver past the right edge — moved left
 * rather than let out of the chart.
 */
export function placeSpan(
  start: number,
  end: number,
  win: { from: number; to: number },
  floor: number,
): { left: number; width: number } | null {
  const len = win.to - win.from;
  const l = ((start - win.from) / len) * 100;
  const r = ((end - win.from) / len) * 100;
  if (r < 0 || l > 100) return null;
  const left = Math.max(0, l);
  const width = Math.max(floor, Math.min(100, r) - left);
  return { left: Math.min(left, 100 - width), width };
}
