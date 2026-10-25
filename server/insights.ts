// The account's insights for one caller (FOL-72 step 8): core insights.ts
// over the whole records of the runs in the window, in the workspaces they
// may see — the Observe page, GET /api/insights and `foldrun insights`.

import { listRunSummaries, listWorkspaces, readRun, type RunRecord } from "@/lib/store";
import { findInsights, type Insight } from "@/lib/insights";
import { scopeAllows } from "@/platform/scope";

/** Whole records are read, so a workspace's newest this many at most. */
const PER_WORKSPACE = 300;

export function accountInsights(tenant: string, scope: string[] | null, days = 7, only?: string | null, now = Date.now()): Insight[] {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const runs: (RunRecord & { workspace: string })[] = [];
  for (const w of listWorkspaces(tenant)) {
    if (!scopeAllows(scope, w.name) || (only && w.name !== only)) continue;
    for (const s of listRunSummaries(tenant, w.name).filter((r) => r.startedAt >= cutoff && !r.test).slice(0, PER_WORKSPACE)) {
      const r = readRun(tenant, w.name, s.id);
      if (r) runs.push({ ...r, workspace: w.name });
    }
  }
  return findInsights(runs);
}
