// Re-run a finished flow from one of its steps, as a new run. The body picks
// the point: { agent: "emailer" } for the first step running that agent, or
// { step: 2 } by the trace's own 1-based numbering. Steps before it are
// carried with their results as context and never billed again; the chosen
// step and everything after runs fresh — later steps consumed the earlier
// ones' results, so re-running only the middle would ship stale work.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission, ApiError } from "@/server/api";
import { rerunFrom } from "@/platform/queue";
import { wantsWait, waitAndRespond } from "@/server/wait";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const body = (await req.json().catch(() => ({}))) as { agent?: string; step?: number; instruction?: string };
    if (!body.agent && typeof body.step !== "number") {
      return NextResponse.json(
        { error: "expected { agent } or { step } — where to re-run from" },
        { status: 400 },
      );
    }
    if (body.instruction !== undefined && typeof body.instruction !== "string") throw new ApiError("instruction is text: what the step it starts from is told this once", 400);
    const run = await rerunFrom(tenant, workspace, runId, { agent: body.agent, step: body.step }, actor.kind === "user" ? actor.name : null, { instruction: body.instruction });
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    return NextResponse.json({ ok: true, runId: run.id, from: runId, steps: run.steps.length });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
