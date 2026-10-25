// Where a run lives: its own page. One helper, so every list, card, alert
// and search result that names a run opens the same place — plain module,
// no React, safe on the server and in the browser.

export const runHref = (workspace: string, runId: string, tenant?: string | null) =>
  `/dashboard/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}${tenant && tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;
