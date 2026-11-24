// A turn on a person's own computer included these messages (FOL-236): it
// makes no run to bind them to, so they are used here in one step — by the
// same rule as a cloud turn's claim, a message is used by one turn only.
// Used, they no longer wait, no longer count toward the waiting limit, and
// are never offered again. `refused` names the ids it could not take (not
// this conversation's, gone, or already in another turn).
//
// Needs `run:start` in the project: the right that includes a message in a
// turn.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { requireWorkspace } from "@/lib/storage";
import { jsonObject } from "@/server/body";
import { idempotent } from "@/server/idempotency";
import { contextIdProblem } from "@/lib/conversation";
import { takeSessionMessages, SessionMessagesUnavailable } from "@/platform/session-messages";

type Ctx = { params: Promise<{ workspace: string; context: string }> };

/** As many as may wait for one conversation at once (session-messages WAITING_MAX). */
const IDS_MAX = 100;

async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace, context } = await ctx.params;
    const { tenant } = await requirePermission(req, "run:start");
    requireWorkspace(tenant, workspace);
    const problem = contextIdProblem(context);
    if (problem) return refuse(problem, 400);
    const body = (await jsonObject(req)) as { ids?: unknown };
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > IDS_MAX || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) {
      return refuse(`ids: the messages the turn included, 1–${IDS_MAX} message ids`, 400);
    }
    const { taken, refused } = await takeSessionMessages(tenant, workspace, context, ids as string[]);
    return NextResponse.json({ taken, refused });
  } catch (err) {
    if (err instanceof SessionMessagesUnavailable) return refuse(err.message, 503);
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
