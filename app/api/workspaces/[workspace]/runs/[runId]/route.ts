import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { deleteRun, readRun } from "@/lib/store";
import { stopRun } from "@/platform/queue";
import { wantsWait, waitAndRespond } from "@/server/wait";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    const run = readRun(tenant, workspace, runId);
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    // ?wait=true[&timeout=N] on a run already started: the same verdict
    // shape the run routes give, so a caller can keep waiting in short
    // requests instead of one long one. Anything in front of the platform
    // cuts a silent request (Cloudflare at 100 s, an ALB at 60 s) and a
    // flow can run for many minutes; `foldrun invoke --wait` asks in
    // 25-second pieces and comes back here for each one.
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    return NextResponse.json(run);
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
    const run = readRun(tenant, workspace, runId);
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    if (run.status !== "completed" && run.status !== "failed") {
      stopRun(tenant, workspace, runId);
    }
    deleteRun(tenant, workspace, runId);
    return NextResponse.json({ ok: true, deleted: runId });
  } catch (err) {
    return errorResponse(err);
  }
}
