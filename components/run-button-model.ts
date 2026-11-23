// What the Run button sends and where a started run is opened. Kept apart
// from the component so a test can hold it.

/** The body of a run start: the task when there is one, test only when asked. */
export function runBodyOf(task: string, test: boolean): { task?: string; test?: true } {
  const t = task.trim();
  return { ...(t ? { task: t } : {}), ...(test ? { test: true as const } : {}) };
}

/** The page of a run just started, from the endpoint the button posted to
 *  (/v1/workspaces/<workspace>/…/run). Null when the endpoint is not that
 *  shape or the answer carried no run id. */
export function runPageOf(endpoint: string, runId: unknown, tenant: string): string | null {
  const m = /^\/v1\/workspaces\/([^/]+)\//.exec(endpoint);
  if (!m || typeof runId !== "string" || !runId) return null;
  return `/dashboard/${m[1]}/runs/${encodeURIComponent(runId)}${tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;
}
