// Propose a fix now (platform improve.ts): for a grader, from its failed
// grades no proposal has covered; for an eval that runs cases, from its last
// result's failed cases. The assistant drafts it; nothing is written until a
// person applies it (…/proposals/<id>).
//
//   POST → 202 the proposal, drafting — poll GET …/proposals/<id>
//
// 409 when there is nothing to fix, or a proposal for this eval is already
// open. Needs run:start: the draft is a model call on the account.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, actorOf, ApiError } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { adminState, pauseOf } from "@/platform/admin";
import { proposeNow } from "@/platform/improve";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const { tenant } = await requirePermission(req, "run:start");
    // The kill switch holds here too: a judge or a draft is paid work, and
    // neither goes through the run queue that refuses a paused workspace.
    const halt = pauseOf(await adminState(tenant), workspace);
    if (halt) throw new ApiError(`${halt.scope === "account" ? "the account" : "this workspace"} is paused — resume it first`, 409);
    const p = await proposeNow(tenant, workspace, evalName, await actorOf(req));
    return NextResponse.json(p, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
