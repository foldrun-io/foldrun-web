// The live run panel's rules, apart from the browser: when a run is over,
// which step cards open on their own, whether a server snapshot is newer
// than what the stream already showed, and what the tab should say. Pinned
// by tests/live-run.test.ts — these decide what a person watching a run
// sees move, and a wrong one is "the page is stuck" with nothing to grep.

import type { RunRecord, StepRecord } from "@/lib/store";

type RunStatus = RunRecord["status"];

/** A run that will never change again. Everything else — queued, running,
 *  parked at a gate — is live: a gate is a pause, not an end, and the page
 *  has to be listening when the person who approves it does. */
export function isRunTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed";
}

/** Whether step `i` opens by default — with nobody having clicked it.
 *
 *  While the run is live only the active step is open: the one running,
 *  the one waiting at a gate, or one waiting for room to start. Several may be active at once (a group
 *  runs in parallel); all of them open. On a finished run the step that
 *  failed stays open, or else the last one that did anything. */
export function defaultUnfolded(run: Pick<RunRecord, "status" | "steps">, i: number): boolean {
  const step = run.steps[i];
  if (!step) return false;
  if (step.status === "running" || step.status === "awaiting-approval") return true;
  // Waiting for room: open, so why and since when read without a click.
  if (step.status === "pending" && step.roomWait) return true;
  if (!isRunTerminal(run.status)) return false;
  const failedAt = run.steps.findIndex((s) => s.status === "failed");
  if (failedAt >= 0) return i === failedAt;
  // The last step that ran, not the last row: a trailing skipped `else`
  // branch or an unreached optional step has nothing to show.
  let last = -1;
  for (let j = 0; j < run.steps.length; j++) {
    const s = run.steps[j].status;
    if (s === "completed" || s === "failed") last = j;
  }
  return i === (last >= 0 ? last : run.steps.length - 1);
}

/** The step the reader most wants right now: the first running one, else
 *  the first waiting at a gate, else on a finished run the one
 *  `defaultUnfolded` picks. -1 when nothing has happened yet — a queued
 *  run has no active step, and saying "step 1" would claim it had begun. */
export function activeStep(run: Pick<RunRecord, "status" | "steps">): number {
  const running = run.steps.findIndex((s) => s.status === "running");
  if (running >= 0) return running;
  const waiting = run.steps.findIndex((s) => s.status === "awaiting-approval");
  if (waiting >= 0) return waiting;
  if (!isRunTerminal(run.status)) return -1;
  for (let i = 0; i < run.steps.length; i++) if (defaultUnfolded(run, i)) return i;
  return -1;
}

const STEP_RANK: Record<string, number> = {
  pending: 0,
  "awaiting-approval": 2,
  running: 4,
  completed: 6,
  failed: 6,
  skipped: 6,
  expanded: 6,
};

/** A step's place in its life. An approval writes the step back to
 *  `pending` with an approved stamp, and the worker makes it `running` a
 *  moment later; that stamped pending is further along than the gate it
 *  came from, not before it — read as before it, the page kept the gate
 *  and its buttons on screen after the person had pressed one. */
function stepRank(s: StepRecord): number {
  if (s.status === "pending" && s.approvedAt) return 3;
  return STEP_RANK[s.status] ?? 0;
}

/** How far along a record is, as one number that only ever grows over a
 *  run's life. The panel holds the newest state it has seen over the
 *  stream; a page refresh hands it the server's snapshot, read a moment
 *  earlier, and that snapshot must not roll the picture back — a step
 *  that was "running" flickering to "waiting" and forward again. Events
 *  are appended, step statuses only advance, and the run ends once, so
 *  the sum is monotonic; a snapshot with a smaller one is stale. */
export function progress(run: Pick<RunRecord, "status" | "steps">): number {
  let n = isRunTerminal(run.status) ? 1_000_000 : run.status === "running" ? 1 : 0;
  for (const s of run.steps) n += stepRank(s) * 1000 + s.events.length;
  return n;
}

/** Take the incoming record only if it is at least as far along as the
 *  one held. Ties go to the incoming one: the same progress with a newer
 *  cost or result is still the newer record. */
export function newer<T extends Pick<RunRecord, "status" | "steps">>(held: T, incoming: T): T {
  return progress(incoming) >= progress(held) ? incoming : held;
}

/** What the browser tab says while a run is watched, so a person who
 *  switched tabs can see where it is without coming back. The glyph is
 *  the state — it reads at tab-strip width where words do not. */
export function tabTitle(run: Pick<RunRecord, "status" | "steps" | "flow" | "stopRequested">, appName = "foldrun"): string {
  const total = run.steps.length;
  const idx = activeStep(run);
  const where = idx >= 0 ? `step ${idx + 1}/${total}` : "";
  const glyph =
    run.status === "completed" ? "✓" :
    run.status === "failed" ? (run.stopRequested ? "■" : "✗") :
    run.status === "awaiting-approval" ? "◐" :
    run.status === "queued" ? "○" : "●";
  const word =
    run.status === "awaiting-approval" ? "waiting" :
    run.status === "failed" && run.stopRequested ? "stopped" :
    run.status;
  return [`${glyph} ${word}`, where, run.flow, appName].filter(Boolean).join(" · ");
}

/** One server-sent event, framed as the spec wants it. A payload with
 *  newlines in it — the run record is written pretty-printed — must go out
 *  as one `data:` line per line of payload; the browser joins them back
 *  with newlines. Sent as a single `data:` line it is not a syntax error,
 *  it is a frame whose data is the first line, `{`, and every line after
 *  it an unknown field the parser drops. That was the run stream from the
 *  day it was written: a socket that connected, ticked, and never once
 *  delivered a record the page could parse. */
export function sseFrame(event: string, data: string): string {
  return `event: ${event}\n${data.split("\n").map((line) => `data: ${line}`).join("\n")}\n\n`;
}

/** Where a `wait: event` step is released, read from its own trace: the
 *  runner prints `release it with POST <url>` when the step parks (core
 *  runner.ts, eventUrl in webhook.ts). The run record carries no other copy
 *  — the token is derived on the server — so the trace line is the source.
 *  `url` is as printed (absolute when the install knows its origin), `path`
 *  the same-origin path the dashboard posts to, so an origin that differs
 *  from the page's never turns a release into a cross-origin request.
 *  Null when the step is not an event wait or the line is missing. */
export function eventRelease(step: Pick<StepRecord, "waitFor" | "events">): { url: string; path: string } | null {
  if (step.waitFor !== "event") return null;
  for (let i = step.events.length - 1; i >= 0; i--) {
    const m = /release it with POST (\S+)/.exec(step.events[i]?.text ?? "");
    if (!m) continue;
    const url = m[1];
    const at = url.indexOf("/api/events/");
    if (at < 0) continue;
    return { url, path: url.slice(at) };
  }
  return null;
}

/** How a typed event payload is sent: JSON when it parses as JSON, plain
 *  text otherwise — the events route takes any body and hands the step the
 *  text. `error` is set for something that looks like JSON (starts with
 *  `{` or `[`) and does not parse, which is a typo worth catching before
 *  it releases the run. */
export function eventBody(text: string): { body: string; contentType: string; error: string | null } {
  const t = text.trim();
  if (!t) return { body: "", contentType: "text/plain", error: null };
  try {
    return { body: JSON.stringify(JSON.parse(t)), contentType: "application/json", error: null };
  } catch (err) {
    const looksJson = t.startsWith("{") || t.startsWith("[");
    return { body: t, contentType: "text/plain", error: looksJson ? `not valid JSON: ${err instanceof Error ? err.message : String(err)}` : null };
  }
}
