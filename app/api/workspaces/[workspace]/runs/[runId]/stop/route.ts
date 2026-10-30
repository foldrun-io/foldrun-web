// Stop a run in flight: drop its queued job, destroy the sandbox the current
// step is spending in, and mark the record stopped. Finished steps keep
// their results and their costs — they ran.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/server/api";
import { stopRun } from "@/platform/queue";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const run = stopRun(tenant, workspace, runId);
    return NextResponse.json({ ok: true, runId: run.id, status: run.status });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
