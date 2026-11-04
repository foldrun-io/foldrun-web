// The account Observe page's analysis, for one caller: the window and the one
// before it, why runs went wrong, which desk is worst, each day, and the
// agents and tools to watch. One function for the page
// (app/dashboard/observe/page.tsx) and GET /api/observe (`foldrun observe`),
// so the dashboard and the CLI cannot disagree about what a window held.
//
// The shaping rules are components/account-observe-model.ts; this only
// gathers what they read, in the workspaces the caller may see.

import { listAllRuns, listFlows, listWorkspaces } from "@/lib/store";
import { observeWorkspace } from "@/platform/observe";
import { scopeAllows } from "@/platform/scope";
import { runLite } from "@/server/run-lite";
import { runCharges } from "@/server/run-charges";
import type { RunLite } from "@/components/mission-model";
import {
  accountTimezone,
  agentsToWatch,
  causes,
  deskHealth,
  kpis,
  perDay,
  toolsAcross,
  windows,
  DAY,
  type AgentRow,
  type CauseRow,
  type DayBucket,
  type DeskHealth,
  type Kpis,
  type ToolRow,
} from "@/components/account-observe-model";

export interface AccountObservation {
  days: number;
  /** The workspaces it covers — every one the caller may see. */
  workspaces: string[];
  /** Where "a day" begins: the zone most of the account's schedules use. */
  timezone: string;
  /** The window, and the one of the same length before it, as ISO instants. */
  window: { from: string; to: string };
  previous: { from: string; to: string; runs: number };
  kpis: Kpis;
  causes: CauseRow[];
  desks: DeskHealth[];
  agents: AgentRow[];
  tools: ToolRow[];
  daily: DayBucket[];
}

export async function accountObservation(tenant: string, scope: string[] | null, days: number, now = Date.now()): Promise<AccountObservation> {
  const workspaces = listWorkspaces(tenant)
    .filter((w) => scopeAllows(scope, w.name))
    .map((w) => w.name);
  const charges = await runCharges(tenant);
  const lite = listAllRuns(tenant)
    .filter((r) => scopeAllows(scope, r.workspace))
    .map((r) => runLite(r, charges));
  const timezone = accountTimezone(
    workspaces.flatMap((w) => {
      try {
        return listFlows(tenant, w).map((f) => f.timezone);
      } catch {
        return [];
      }
    }),
  );
  const { cur, prev } = windows(lite, now, days);
  const per = workspaces.map((w) => observeWorkspace(tenant, w, days, undefined, charges));
  const start = now - days * DAY;
  return {
    days,
    workspaces,
    timezone,
    window: { from: new Date(start).toISOString(), to: new Date(now).toISOString() },
    previous: { from: new Date(start - days * DAY).toISOString(), to: new Date(start).toISOString(), runs: prev.length },
    kpis: kpis(cur, prev),
    causes: causes(cur),
    desks: deskHealth(workspaces, cur, prev),
    agents: agentsToWatch(per, 10),
    tools: toolsAcross(per, 10),
    // A week at least, so a 24-hour window still shows its shape.
    daily: perDay(cur, now, Math.max(days, 7), timezone),
  };
}

/** A run as the API names it inside the analysis: enough to open it. */
export const runRef = (r: RunLite) => ({
  workspace: r.workspace,
  id: r.id,
  what: r.what,
  outcome: r.outcome,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  failure: r.failure,
});

/** GET /api/observe's answer: the analysis, each run it names cut to a
 *  runRef and each agent to the fields the page reads. */
export function observationJson(a: AccountObservation) {
  return {
    days: a.days,
    timezone: a.timezone,
    window: a.window,
    previous: a.previous,
    kpis: a.kpis,
    causes: a.causes.map((c) => ({ kind: c.kind, key: c.key, label: c.label, platform: c.platform, count: c.count, desks: c.desks, sample: c.sample, newest: runRef(c.newest) })),
    desks: a.desks.map((d) => ({ ...d, lastBad: d.lastBad ? runRef(d.lastBad) : null })),
    agents: a.agents.map((x) => ({
      workspace: x.workspace,
      agent: x.agent,
      steps: x.steps,
      failed: x.failed,
      retried: x.retried,
      costUsd: x.costUsd,
      chargedUsd: x.chargedUsd ?? null,
      seconds: x.seconds,
    })),
    tools: a.tools,
    daily: a.daily,
  };
}
