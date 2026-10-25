// The runs bulk bar's plumbing, without React: which POST /runs/bulk calls a
// selection becomes, and what the answers say was refused. A selected run is
// `<workspace>/<runId>` (run-key.ts), and the route is per workspace — so a
// selection on the account-wide list, which spans workspaces, is one call per
// workspace, and never more than the route's cap of runs in one call.

/** POST /api/workspaces/<ws>/runs/bulk touches at most this many runs per
 *  call (app/api/workspaces/[workspace]/runs/bulk/route.ts, MAX). */
export const BULK_MAX = 100;

export interface BulkCall {
  workspace: string;
  runIds: string[];
}

/** The calls a selection becomes: grouped by workspace in the order the
 *  workspaces first appear, each group cut into chunks of at most `max`. */
export function bulkCalls(runs: { workspace: string; id: string }[], max = BULK_MAX): BulkCall[] {
  const by = new Map<string, string[]>();
  for (const r of runs) {
    const ids = by.get(r.workspace) ?? [];
    if (!ids.includes(r.id)) ids.push(r.id);
    by.set(r.workspace, ids);
  }
  const calls: BulkCall[] = [];
  for (const [workspace, ids] of by) {
    for (let i = 0; i < ids.length; i += max) calls.push({ workspace, runIds: ids.slice(i, i + max) });
  }
  return calls;
}

export interface BulkAnswer {
  runs?: { runId: string; ok: boolean; newRunId?: string; error?: string }[];
  error?: string;
}

/** The refusals in one call's answer, as the bar lists them
 *  (`<workspace>/<runId>: <why>`). A call refused whole — a 4xx with no
 *  per-run list — refuses every run it carried. */
export function refusalsOf(call: BulkCall, httpOk: boolean, answer: BulkAnswer, status?: number): string[] {
  if (!httpOk || !Array.isArray(answer.runs)) {
    const why = answer.error ?? (status ? `HTTP ${status}` : "no answer");
    return call.runIds.map((id) => `${call.workspace}/${id}: ${why}`);
  }
  const answered = new Set(answer.runs.map((r) => r.runId));
  return [
    ...answer.runs.filter((r) => !r.ok).map((r) => `${call.workspace}/${r.runId}: ${r.error ?? "refused"}`),
    // Asked for, but not matched — gone since the page rendered.
    ...call.runIds.filter((id) => !answered.has(id)).map((id) => `${call.workspace}/${id}: not found (deleted since the page loaded?)`),
  ];
}
