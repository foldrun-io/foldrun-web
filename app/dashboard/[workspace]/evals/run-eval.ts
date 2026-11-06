// Run one eval and wait for its verdict — the list's Run button and the
// eval's own page both start it this way, so there is one copy of the poll.
//
// Started, not waited on: an eval of slow cases outlives the proxy in front
// of the dashboard (Cloudflare's 100 s), so it runs on and this polls for its
// result, by this run's id — its own verdict, whatever else runs or writes
// the latest result meanwhile.

import type { EvalResult } from "@/lib/evals";

export async function runEval(workspace: string, tenant: string, name: string): Promise<EvalResult> {
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };
  const res = await fetch(`/api/workspaces/${workspace}/evals/${name}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ async: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  if (res.status !== 202) return data as EvalResult;
  const runId = encodeURIComponent(String(data.runId ?? ""));
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(`/api/workspaces/${workspace}/evals/${name}/run?run=${runId}`, { headers });
    const view = (await poll.json()) as { state?: string; error?: string; result?: EvalResult };
    if (!poll.ok) throw new Error(`could not read the run's state (${view.error ?? poll.status}) — it may still be running; reload to see`);
    if (view.state === "running") continue;
    if (view.state === "done" && view.result) return view.result;
    throw new Error(view.error ?? `the run ended as ${view.state ?? "unknown"}, with no result`);
  }
}
