// Paging the runs list (5 Nov 2026). The list grows at the top, so a page is
// "the runs older than this one", not an offset: page two by offset shifts
// by however many runs started while page one was read. A cursor is a
// position — `<startedAt>~<runId>` — not a run that must still exist, so a
// run deleted between two pages breaks nothing, and the same cursor pages
// every workspace at once (the CLI merges the account's runs with it).
//
// The order is startedAt newest first, then id, so two runs that started in
// the same millisecond still have one place each.

import { ApiError } from "./api";

export type RunCursor = { startedAt: string; id: string | null };
type Positioned = { id: string; startedAt: string };

/** Newest first; a tie on startedAt is broken by id, descending. */
export function byPosition(a: Positioned, b: Positioned): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The cursor that answers as `next`: the position of the last run sent. */
export function cursorOf(r: Positioned): string {
  return `${r.startedAt}~${r.id}`;
}

const ISO_START = /^\d{4}-\d{2}-\d{2}/;

/**
 * What `before=` names: a cursor `<startedAt>~<runId>` (what `next` gave),
 * a time (runs that started before it), or a run id of this list (runs
 * older than that run). Null when the parameter is absent. A time that is
 * not one, or a run the list does not hold, is a 400 — a typo must not
 * quietly answer the newest page again.
 */
export function parseBefore(raw: string | null, runs: Positioned[]): RunCursor | null {
  if (raw === null) return null;
  const v = raw.trim();
  if (!v) throw new ApiError("before: give a cursor (next from the last page), a time or a run id", 400);
  const tilde = v.indexOf("~");
  if (tilde > 0) {
    const startedAt = v.slice(0, tilde);
    const id = v.slice(tilde + 1);
    if (!ISO_START.test(startedAt) || Number.isNaN(Date.parse(startedAt)) || !id) {
      throw new ApiError(`before: "${v}" is not a cursor — pass back the next of the last page`, 400);
    }
    return { startedAt, id };
  }
  if (ISO_START.test(v)) {
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new ApiError(`before: "${v}" is not a time`, 400);
    return { startedAt: new Date(t).toISOString(), id: null };
  }
  const run = runs.find((r) => r.id === v);
  if (!run) throw new ApiError(`before: no run ${v} in this workspace — pass a cursor (next) or a time instead`, 400);
  return { startedAt: run.startedAt, id: run.id };
}

/** True when r comes after the cursor in the list's order (is older). */
export function isAfter(r: Positioned, c: RunCursor): boolean {
  if (r.startedAt !== c.startedAt) return r.startedAt < c.startedAt;
  return c.id !== null && r.id < c.id;
}
