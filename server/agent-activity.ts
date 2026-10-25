// The agents of a workspace with when each last ran, and whether it is past
// the workspace's `alerts: stale_days` — one function for the agents route
// (and so the CLI) and the agent list, so both say the same.

import fs from "node:fs";
import path from "node:path";
import { listAgents, listRunSummaries, workspaceDir, accountDir, type AgentInfo } from "@/lib/store";
import { agentLastRuns, daysSince } from "@/lib/agent-activity";
import { parseAlerts } from "@/lib/alerts";
import { readAgentsMdKeys } from "@/lib/agents-md";

export type AgentWithActivity = AgentInfo & {
  /** When its latest step that ran started; null when no run kept names it. */
  lastRunAt: string | null;
  /** Past `alerts: stale_days` (the workspace's, else the account's), counted
   *  from its last run or, never run, from when its file last changed — as
   *  the watchdog counts. False when stale_days is unset. */
  stale: boolean;
};

/** `alerts: stale_days`, as the watchdog reads it: the workspace's alerts block, else the account's. */
export function staleDaysOf(tenant: string, workspace: string): number | null {
  const ws = readAgentsMdKeys(workspaceDir(tenant, workspace));
  const block = ws.alerts !== undefined ? ws.alerts : readAgentsMdKeys(accountDir(tenant)).alerts;
  return parseAlerts(block).config?.staleDays ?? null;
}

export function agentsWithActivity(tenant: string, workspace: string, now = Date.now()): AgentWithActivity[] {
  let last = new Map<string, string>();
  try {
    last = agentLastRuns(listRunSummaries(tenant, workspace));
  } catch {
    /* no run index: every agent reads as never run */
  }
  const staleDays = staleDaysOf(tenant, workspace);
  return listAgents(tenant, workspace).map((a) => {
    const lastRunAt = last.get(a.name) ?? null;
    let from = lastRunAt;
    if (!from && staleDays !== null) {
      try {
        from = fs.statSync(path.join(workspaceDir(tenant, workspace), "agents", a.name, "agent.md")).mtime.toISOString();
      } catch {
        from = null;
      }
    }
    const idle = daysSince(from, now);
    return { ...a, lastRunAt, stale: staleDays !== null && idle !== null && idle >= staleDays };
  });
}
