// Erasing one run — what DELETE …/runs/<id> and POST …/runs/bulk
// { action: "delete" } both do, through this one function (FOL-75, 5 Nov
// 2026), so the two doors cannot drift apart.
//
// A run still in flight is stopped first: deleting the record out from under
// a live driver would leave a sandbox running with nothing to report to.
// stopRun marks the run stopped and asks the executor to kill its sandbox; a
// kill that fails is logged there and the record goes anyway — the same as
// a single DELETE always did. The ledger line stays: money is not deleted
// because a trace was.

import { deleteRun, readRun } from "@/lib/store";
import { stopRun } from "@/platform/queue";

/** Erase one run; false when there is no such run. */
export function eraseRun(tenant: string, workspace: string, runId: string): boolean {
  const run = readRun(tenant, workspace, runId);
  if (!run) return false;
  if (run.status !== "completed" && run.status !== "failed") stopRun(tenant, workspace, runId);
  deleteRun(tenant, workspace, runId);
  return true;
}
