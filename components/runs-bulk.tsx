"use client";

// The runs list's bulk actions and selection, on top of the generic
// bulk-select kit. A selected run is `<workspace>/<runId>`, because the
// account-wide list spans workspaces and the API is per workspace.
//
// Stop and Rerun go through POST /api/workspaces/<ws>/runs/bulk, the same
// route the CLI uses, once per workspace in the selection
// (runs-bulk-model.ts). Delete has no bulk route, so it stays one DELETE per
// run.

import { type ReactNode } from "react";
import { BulkActionBar, SelectionProvider, type BulkAction } from "@/components/bulk-select";
import { useCan } from "@/components/role";
import { runKey } from "@/components/run-key";
import { bulkCalls, refusalsOf, type BulkAnswer } from "@/components/runs-bulk-model";

export interface RunSelectable {
  workspace: string;
  id: string;
  /** Display status, so "Stop" is offered for exactly the rows whose badge
   *  says they could be stopped. */
  status: string;
}

const STOPPABLE = new Set(["running", "queued", "awaiting-approval"]);
/** What the queue will re-run: a finished run ("stopped" is a failed run
 *  someone stopped). */
const RERUNNABLE = new Set(["completed", "failed", "stopped"]);

async function call(endpoint: string, tenant: string, method: string) {
  const res = await fetch(endpoint, {
    method,
    headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `${res.status}`);
  }
}

/** One runs/bulk call per workspace; the refusals across all of them. */
async function bulk(action: "stop" | "rerun", runs: RunSelectable[], tenant: string): Promise<string[]> {
  const refused: string[] = [];
  for (const c of bulkCalls(runs)) {
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(c.workspace)}/runs/bulk`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-foldrun-tenant": tenant,
          // A double click, or a retry after a dropped answer, must not
          // start every rerun twice.
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action, runIds: c.runIds }),
      });
      const answer = (await res.json().catch(() => ({}))) as BulkAnswer;
      refused.push(...refusalsOf(c, res.ok, answer, res.status));
    } catch (err) {
      refused.push(...refusalsOf(c, false, { error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return refused;
}

export function RunsSelection({
  runs,
  tenant,
  children,
}: {
  runs: RunSelectable[];
  tenant: string;
  children: ReactNode;
}) {
  // Stopping, rerunning and deleting all need run:start, as their routes do;
  // a viewer gets no checkboxes at all rather than a selection with nothing
  // to do.
  const mayWrite = useCan("run:start");
  const byKey = new Map(runs.map((r) => [runKey(r), r]));
  const endpoint = (key: string) => {
    const r = byKey.get(key)!;
    return `/api/workspaces/${r.workspace}/runs/${r.id}`;
  };
  const picked = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((r): r is RunSelectable => !!r);
  const actions: BulkAction[] = [
    {
      label: "Stop",
      applies: (key) => STOPPABLE.has(byKey.get(key)?.status ?? ""),
      confirm: (n) => ({
        title: `Stop ${n} run${n === 1 ? "" : "s"}?`,
        body: "Each stops after its current step; the sandbox it was using is destroyed. What they have written so far stays.",
      }),
      performAll: (keys) => bulk("stop", picked(keys), tenant),
    },
    {
      label: "Rerun",
      applies: (key) => RERUNNABLE.has(byKey.get(key)?.status ?? ""),
      confirm: (n) => ({
        title: `Rerun ${n} run${n === 1 ? "" : "s"}?`,
        body: "Each starts again from its first step as a new run with the flow's instructions as they read now, and is billed like any other run. The originals stay as they are.",
        confirmLabel: "Rerun",
      }),
      performAll: (keys) => bulk("rerun", picked(keys), tenant),
    },
    {
      label: "Delete",
      tone: "destructive",
      confirm: (n) => ({
        title: `Delete ${n} run${n === 1 ? "" : "s"}?`,
        body: "Their records and outputs go. Anything still running is stopped first. Ledger entries they were charged on stay.",
      }),
      perform: (key) => call(endpoint(key), tenant, "DELETE"),
    },
  ];
  return (
    <SelectionProvider ids={runs.map(runKey)} enabled={mayWrite}>
      <BulkActionBar actions={actions} noun="runs" />
      {children}
    </SelectionProvider>
  );
}
