// One tool call's recorded input and output (FOL-54 step 4), secrets
// masked: kept beside the run, not in its record, so the run itself stays
// light. A workspace with `capture: metadata` records none.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readCapturedCall, readRun } from "@/lib/store";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string; callId: string }> }) {
  try {
    const { workspace, runId, callId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return refuse("run not found", 404);
    const call = readCapturedCall(tenant, workspace, runId, callId);
    if (!call) return refuse(`no recorded content for call "${callId}" — it was not captured (capture: metadata, or a run from before 19 Oct 2026)`, 404);
    return NextResponse.json({ call });
  } catch (err) {
    return errorResponse(err);
  }
}
