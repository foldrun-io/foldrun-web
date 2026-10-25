// The account overview's one list of workspaces. It used to be two: the
// heartbeat table (strip, success, spend) and the workspace cards (avatar,
// description, last run, spend again, live again) — the same 22 desks drawn
// twice, one under the other. A DeskRow is both, plus when it next runs.
// Pure; tests/desks.test.ts pins it.

import type { Heartbeat } from "./mission-model";

export interface DeskRow {
  name: string;
  description: string;
  avatar?: string;
  agents: number;
  flows: number;
  beat: Heartbeat;
  /** The next scheduled fire, if any flow here is scheduled. */
  next: { flow: string; at: string } | null;
  /** The newest live run, so "2 live" is a door to it. */
  liveRunId: string | null;
}

export interface DeskInput {
  name: string;
  description: string;
  avatar?: string;
  agents: number;
  flows: number;
}

/** Joins the workspaces to their heartbeat and next fire, in heartbeat order
 *  (live first, then broken, then by last run). `upcoming` is every future
 *  fire, soonest first, as the scheduler lists them. */
export function deskRows(workspaces: DeskInput[], beats: Heartbeat[], upcoming: { workspace: string; flow: string; at: string }[]): DeskRow[] {
  const byName = new Map(workspaces.map((w) => [w.name, w]));
  const next = new Map<string, { flow: string; at: string }>();
  for (const u of upcoming) if (!next.has(u.workspace)) next.set(u.workspace, { flow: u.flow, at: u.at });
  const rows: DeskRow[] = [];
  for (const beat of beats) {
    const w = byName.get(beat.workspace);
    if (!w) continue;
    const live = [...beat.cells].reverse().find((r) => r.outcome === "running" || r.outcome === "waiting" || r.outcome === "queued");
    rows.push({
      name: w.name,
      description: w.description,
      avatar: w.avatar,
      agents: w.agents,
      flows: w.flows,
      beat,
      next: next.get(w.name) ?? null,
      liveRunId: live?.id ?? null,
    });
  }
  return rows;
}

export type DeskSort = "activity" | "name" | "spend";

/** Search and order. "activity" keeps the heartbeat order — what needs
 *  looking at on top — which is the reason to open this page. */
export function filterDesks(rows: DeskRow[], query: string, sort: DeskSort): DeskRow[] {
  const q = query.trim().toLowerCase();
  const kept = q
    ? rows.filter((d) =>
        [d.name, d.description, d.beat.last?.headline, d.beat.last?.what, d.next?.flow].some((f) => (f ?? "").toLowerCase().includes(q)),
      )
    : [...rows];
  if (sort === "name") kept.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "spend") kept.sort((a, b) => b.beat.spend7dUsd - a.beat.spend7dUsd || a.name.localeCompare(b.name));
  return kept;
}
