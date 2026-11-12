// One tool call's recorded input and output (FOL-54 step 4), secrets
// masked: kept beside the run (or, with runs.calls_store, in the object
// store), not in its record, so the run itself stays light. A workspace with `capture: metadata` records none.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readRun } from "@/lib/store";
import { readCapturedCallAsync, CapturedCallUnavailable } from "@/lib/captured-calls";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string; callId: string }> }) {
  try {
    const { workspace, runId, callId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return refuse("run not found", 404);
    const call = await readCapturedCallAsync(tenant, workspace, runId, callId);
    if (!call) return refuse(`no recorded content for call "${callId}" — it was not captured (capture: metadata, or a run from before 19 Oct 2026)`, 404);
    return NextResponse.json({ call });
  } catch (err) {
    // Recorded, and now unreadable (the object store, the database): said so, never an empty 200.
    if (err instanceof CapturedCallUnavailable) return refuse(err.message, 502);
    return errorResponse(err);
  }
}
