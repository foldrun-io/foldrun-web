// The account's issues for one caller (FOL-54 step 3): derived from the runs
// they may see (core issues.ts), with what people did to them (platform
// issues.ts). One function, so Home, the Issues page, the API and the CLI
// list the same issues.

import { listAllRuns, listFlows, listWorkspaces } from "@/lib/store";
import { foldIssues, type Issue } from "@/lib/issues";
import { issueStates } from "@/platform/issues";
import { scopeAllows } from "@/platform/scope";
import { runLite } from "@/server/run-lite";
import type { RunLite } from "@/components/mission-model";
import { missedFires } from "@/server/missed";
import { adminState, pauseWindows } from "@/platform/admin";

/** Every issue the runs of the caller's workspaces show. A scoped caller
 *  sees a platform issue only as far as their own desks were hit. */
/** `only`: the workspaces to look at (a workspace's own page passes itself);
 *  unasked, every one the caller may see — from the account, not from the
 *  runs, so a flow that has never started is still checked for missed
 *  schedules (Codex review). */
export async function accountIssues(tenant: string, scope: string[] | null, now = Date.now(), lite?: RunLite[], only?: string[]): Promise<Issue[]> {
  const runs = (lite ?? listAllRuns(tenant).filter((r) => scopeAllows(scope, r.workspace)).map((r) => runLite(r))).filter((r) => scopeAllows(scope, r.workspace));
  const workspaces = (only ?? listWorkspaces(tenant).map((w) => w.name)).filter((w) => scopeAllows(scope, w));
  // FOL-72 step 7: the flows that say `issues: auto-close`, and the fires
  // that started nothing.
  const autoClose = new Set<string>();
  for (const ws of workspaces) {
    try {
      for (const f of listFlows(tenant, ws)) if (f.issues === "auto-close") autoClose.add(`${ws}\u0000${f.name}`);
    } catch {
      /* a workspace that cannot be listed closes nothing on its own */
    }
  }
  const state = await adminState(tenant).catch(() => ({}));
  const missed = missedFires(tenant, workspaces, runs, now, (ws) => pauseWindows(state, ws));
  return foldIssues([...runs, ...missed], await issueStates(tenant), now, { autoClose: (ws, what) => autoClose.has(`${ws}\u0000${what}`) });
}

export const ISSUE_STATUSES = ["active", "open", "acknowledged", "snoozed", "resolved", "all"] as const;
export type IssueFilter = (typeof ISSUE_STATUSES)[number];

/** `active` (the default) is open + acknowledged: what still asks for someone. */
export function filterIssues(issues: Issue[], status: IssueFilter, workspace?: string | null): Issue[] {
  return issues
    .filter((i) => (status === "all" ? true : status === "active" ? i.status === "open" || i.status === "acknowledged" : i.status === status))
    .filter((i) => (workspace ? i.workspaces.includes(workspace) : true));
}
