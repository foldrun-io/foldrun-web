// A run beside another of the same flow (FOL-72 step 6): which files changed
// between the revisions they ran, and step by step what differs. `?with=`
// names the other run; unasked it is the newest earlier run of the flow that
// finished well, else the run this one re-ran.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import { listRunSummaries, readRun, runDisplayStatus, runVerdict } from "@/lib/store";
import { outcomeOf, isSuccess } from "@/lib/outcome";
import { compareRuns, lastGoodBefore } from "@/lib/compare";
import { changedPathsBetween } from "@/lib/history";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string }> }) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    const run = readRun(tenant, workspace, runId);
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const named = req.nextUrl.searchParams.get("with");
    const baseId = named
      ? named
      : lastGoodBefore(listRunSummaries(tenant, workspace), run, (r) => isSuccess(outcomeOf(runDisplayStatus(r), runVerdict(r))))?.id ?? run.rerunOf?.run ?? null;
    if (!baseId) throw new ApiError("nothing to compare with: no earlier run of this flow finished well — name one with ?with=<run-id>", 404);
    const base = readRun(tenant, workspace, baseId);
    if (!base) throw new ApiError(`run ${baseId} not found`, 404);
    if (base.flow !== run.flow) throw new ApiError(`run ${baseId} is ${base.flow}, not ${run.flow} — compare runs of one flow`, 400);
    // Older first, so "changed" reads forwards in time.
    const [older, newer] = base.startedAt <= run.startedAt ? [base, run] : [run, base];
    const files = changedPathsBetween(tenant, workspace, older.revision ?? null, newer.revision ?? null);
    return NextResponse.json({ comparison: compareRuns(base, run, files), chosen: named ? "named" : baseId === run.rerunOf?.run ? "re-run source" : "last good" });
  } catch (err) {
    return errorResponse(err);
  }
}
