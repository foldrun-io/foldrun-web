// The workspace overview's rows, from the records: each flow with its next
// fire and last run, each agent with how it last went, the recent runs.
// Pure; the cron walk is handed in by the page (the scheduler reads disk),
// and tests/workspace-overview.test.ts pins the rest.

import type { AgentInfo, FlowInfo, RunRecord } from "@/lib/store";
import { nodeStats } from "./graph-stats-model.ts";
import { lastRunOf, liveRunOf, isLiveRun, type LastRun } from "./overview-model.ts";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export interface FlowRow {
  name: string;
  file: string;
  trigger: string;
  schedule: string | null;
  timezone: string | null;
  /** When the schedule next fires, ISO; null when it is not scheduled or
   *  does not fire within two months. */
  nextFireAt: string | null;
  steps: number;
  last: LastRun | null;
  runs7d: number;
  spend7d: number;
  /** Runs going or waiting right now. */
  live: number;
  /** The newest of those. The overview used to print "1 live" and stop
   *  there, so the way to the run that was actually going was the Runs page
   *  and a scan for the right id — three clicks to watch the thing the badge
   *  had just told you about. */
  liveRunId: string | null;
}

/** When a schedule next fires after `now`, ISO, or null. The page passes
 *  the scheduler's own cron walk; a test passes whatever it likes. */
export type NextFire = (schedule: string, timezone: string | null, now: number) => string | null;

/** What a run cost the account. The page passes the ledger's charge (list
 *  price until settled, server/run-charges.ts); the default is token cost,
 *  for tests and callers with no ledger. */
export type CostOf = (r: RunRecord) => number;
const tokenCost: CostOf = (r) => r.steps.reduce((c, st) => c + (st.costUsd ?? 0), 0);

export function flowRows(flows: FlowInfo[], runs: RunRecord[], now: number, nextFireAt_: NextFire = () => null, costOf: CostOf = tokenCost): FlowRow[] {
  const cutoff = now - WEEK;
  return flows.map((f) => {
    const own = runs.filter((r) => r.flow === f.name);
    const week = own.filter((r) => Date.parse(r.startedAt) >= cutoff);
    const nextFireAt = f.trigger === "schedule" && f.schedule ? nextFireAt_(f.schedule, f.timezone, now) : null;
    return {
      name: f.name,
      file: f.file,
      trigger: f.trigger,
      schedule: f.schedule,
      timezone: f.timezone,
      nextFireAt,
      steps: f.steps.length,
      last: lastRunOf(own),
      runs7d: week.length,
      spend7d: week.reduce((s, r) => s + costOf(r), 0),
      live: own.filter(isLiveRun).length,
      liveRunId: liveRunOf(own)?.id ?? null,
    };
  });
}

export interface AgentRow {
  name: string;
  description: string;
  model: string;
  /** How its steps went in the most recent run it took part in; null when
   *  it never ran. */
  last: string | null;
  lastAt: string | null;
  runs7d: number;
  spend7d: number;
}

/** `agentCostOf`: one agent's part of a run's money (the ledger's split);
 *  without it, the token cost nodeStats sums. */
export function agentRows(agents: AgentInfo[], runs: RunRecord[], now: number, agentCostOf?: (r: RunRecord, agent: string) => number): AgentRow[] {
  const stats = nodeStats(runs.map((r) => ({ ...r, workspace: "w" })), now, WEEK);
  const week = runs.filter((r) => Date.parse(r.startedAt) >= now - WEEK);
  return agents.map((a) => {
    const s = stats[`agent:w:${a.name}`];
    const spend = agentCostOf
      ? week.filter((r) => r.steps.some((st) => st.agent === a.name)).reduce((n, r) => n + agentCostOf(r, a.name), 0)
      : s?.cost ?? 0;
    return {
      name: a.name,
      description: a.description,
      model: a.model,
      last: s?.last ?? null,
      lastAt: s?.lastAt ?? null,
      runs7d: s?.runs ?? 0,
      spend7d: spend,
    };
  });
}

/** One search box over both lists: name, description, last headline. */
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

/** "in 3h", "in 2d", "in 12m" — or null past the window. */
export function fmtIn(ms: number): string {
  if (ms < 60_000) return "in under a minute";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}
