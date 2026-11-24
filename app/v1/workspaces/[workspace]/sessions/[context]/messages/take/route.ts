// Messages a turn on a person's own computer carries (FOL-236). It makes no
// run to bind them to, so it does it here, in two steps:
//
//   {ids}              — its person said yes: they are held for this turn (the
//                        same atomic claim a cloud turn makes, one turn only),
//                        answered {taken, refused, hold}. Only `taken` may go
//                        in the turn.
//   {hold, outcome}    — "used" once the turn reached the model: they no
//                        longer wait, count toward the limit or come back;
//                        "freed" when it did not: they wait again.
//
// A hold neither used nor freed lapses after 10 minutes. Needs `run:start`
// in the project: the right that includes a message in a turn.

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { requireWorkspace } from "@/lib/storage";
import { jsonObject } from "@/server/body";
import { idempotent } from "@/server/idempotency";
import { contextIdProblem } from "@/lib/conversation";
import { holdSessionMessages, spendHeldSessionMessages, freeHeldSessionMessages, SessionMessagesUnavailable } from "@/platform/session-messages";

type Ctx = { params: Promise<{ workspace: string; context: string }> };

/** As many as may wait for one conversation at once (session-messages WAITING_MAX). */
const IDS_MAX = 100;
const HOLD = /^lt-[A-Za-z0-9_-]{24}$/;

async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace, context } = await ctx.params;
    const { tenant } = await requirePermission(req, "run:start");
    requireWorkspace(tenant, workspace);
    const problem = contextIdProblem(context);
    if (problem) return refuse(problem, 400);
    const body = (await jsonObject(req)) as { ids?: unknown; hold?: unknown; outcome?: unknown };
    if (body.hold !== undefined) {
      if (typeof body.hold !== "string" || !HOLD.test(body.hold)) return refuse("hold: the hold this route gave", 400);
      // Only this project's and conversation's: a hold is no key to another's messages (Codex).
      if (body.outcome === "used") return NextResponse.json({ used: await spendHeldSessionMessages(tenant, workspace, context, body.hold) });
      if (body.outcome === "freed") return NextResponse.json({ freed: await freeHeldSessionMessages(tenant, workspace, context, body.hold) });
      return refuse('outcome: "used" (the turn reached the model) or "freed" (it did not)', 400);
    }
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > IDS_MAX || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) {
      return refuse(`ids: the messages the turn is to carry, 1–${IDS_MAX} message ids`, 400);
    }
    const hold = `lt-${crypto.randomBytes(18).toString("base64url")}`;
    const { taken, refused } = await holdSessionMessages(tenant, workspace, context, ids as string[], hold);
    return NextResponse.json({ taken, refused, hold });
  } catch (err) {
    if (err instanceof SessionMessagesUnavailable) return refuse(err.message, 503);
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
