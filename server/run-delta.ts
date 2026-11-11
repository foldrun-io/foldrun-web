// Run stream deltas and resume (FOL-158).
//
// The stream's `run` event is the whole record every time it changes: on a
// long run that is megabytes, sent again for every new line. With `?delta=1`
// the first event is still the whole record, and after it each `delta` event
// carries only what changed: the run's own fields, and for each step that
// changed its fields without `events` plus the events it gained. Every event
// has an `id:` — the cursor, each step's event count — and a client that
// reconnects with `Last-Event-ID` gets a delta from there, not the record
// again. A cursor that does not fit the record any more (a rerun reshaped
// it, a client from another run) gets the whole record.

export interface RunLike {
  status?: string;
  steps: { events?: unknown[] }[];
  [k: string]: unknown;
}

const CURSOR = /^v1\.(\d+(?:-\d+)*)?$/;

/** The cursor for a record: each step's event count. */
export function cursorOf(run: RunLike): string {
  return `v1.${run.steps.map((s) => (s.events ?? []).length).join("-")}`;
}

/** A cursor's event counts, or null when it is not one of ours. */
export function parseCursor(id: string | null | undefined): number[] | null {
  const m = CURSOR.exec(String(id ?? "").trim());
  if (!m) return null;
  return m[1] ? m[1].split("-").map(Number) : [];
}

const header = (step: Record<string, unknown>) => {
  const { events: _events, ...rest } = step;
  return rest;
};

/**
 * What changed since `counts` (and, live, since the headers last sent): the
 * run without its steps, and `steps` as { index → the step's fields without
 * events, `events`: the events it gained, `from`: the first new event's
 * index }. Null when the cursor does not fit the record — send it whole.
 */
export function deltaSince(run: RunLike, counts: number[], lastHeaders?: string[]): { delta: Record<string, unknown>; headers: string[] } | null {
  if (counts.length > run.steps.length) return null;
  const headers = run.steps.map((s) => JSON.stringify(header(s as Record<string, unknown>)));
  const steps: Record<string, unknown> = {};
  for (let i = 0; i < run.steps.length; i++) {
    const events = run.steps[i]!.events ?? [];
    const had = counts[i] ?? 0;
    if (had > events.length) return null;
    const changedHeader = !lastHeaders || lastHeaders[i] !== headers[i];
    if (had === events.length && !changedHeader) continue;
    steps[i] = { ...header(run.steps[i] as Record<string, unknown>), events: events.slice(had), from: had };
  }
  const { steps: _steps, ...top } = run;
  return { delta: { ...top, steps }, headers };
}
