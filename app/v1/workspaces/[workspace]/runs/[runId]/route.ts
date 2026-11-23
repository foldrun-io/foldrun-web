import { NextRequest, NextResponse } from "next/server";
import { runMoney } from "@/server/run-charges";
import { requireCaller, errorResponse, requirePermission, refuse } from "@/server/api";
import { runFor } from "@/server/run-links";
import { readRunAsync, runFailure } from "@/lib/store";
import { eraseRun } from "@/server/run-erase";
import { wantsWait, waitAndRespond } from "@/server/wait";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    // Off the event loop where the records are in the database.
    const run = await readRunAsync(tenant, workspace, runId);
    if (!run) return refuse("run not found", 404);
    // ?wait=true[&timeout=N] on a run already started: the same verdict
    // shape the run routes give, so a caller can keep waiting in short
    // requests instead of one long one. Anything in front of the platform
    // cuts a silent request (Cloudflare at 100 s, an ALB at 60 s) and a
    // flow can run for many minutes; `foldrun invoke --wait` asks in
    // 25-second pieces and comes back here for each one.
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    // Why it failed, as the runs list and the run page say it (FOL-124).
    // Its money (FOL-157): the charge once the ledger settles it, the
    // list-price estimate until then, and which is final.
    // A caller who may not run things is not handed the link that releases a parked step (run-links.ts).
    return NextResponse.json({ ...runFor(run, actor), failure: runFailure(run), ...(await runMoney(tenant, run)) });
  } catch (err) {
    return errorResponse(err);
  }
}

// Erase a run from history — its record and its archived outputs. A run
// still in flight is stopped first: deleting the record out from under a
// live driver would leave a sandbox running with nothing to report to.
// The ledger line stays; money is not deleted because a trace was.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    // Erasing what happened is not running things: workspace:manage (an
    // admin), not run:start — an editor could wipe the trail of a run they
    // started that sent mail or made a bad change (30 Oct 2026).
    const tenant = (await requirePermission(req, "workspace:manage")).tenant;
    // The same erase POST …/runs/bulk { action: "delete" } does (run-erase.ts).
    if (!eraseRun(tenant, workspace, runId)) return refuse("run not found", 404);
    return NextResponse.json({ ok: true, deleted: runId });
  } catch (err) {
    return errorResponse(err);
  }
}
