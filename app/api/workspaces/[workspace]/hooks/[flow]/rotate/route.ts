// Rotate one webhook's URL. The old token stops working the moment this
// returns; the response carries the new path. Storage is a generation
// counter, not a token — see core/src/webhook.ts.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/server/api";
import { rotateWebhook } from "@/lib/webhook";
import { idempotent } from "@/server/idempotency";
import { requireWebhookFlow } from "@/server/webhook-flow";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; flow: string }> },
) {
  try {
    const tenant = (await requirePermission(req, "workspace:manage")).tenant;
    const { workspace, flow } = await ctx.params;
    // 404 for no such flow, 409 for one that is not a webhook — as GET
    // …/hooks/<flow> answers — rather than a URL nothing will ever call.
    requireWebhookFlow(tenant, workspace, flow);
    const path = rotateWebhook(tenant, workspace, flow);
    return NextResponse.json({ ok: true, path });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. The new path
 *  carries the token, so a replay answers it as null. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args), { secretFields: ["path"] });
}
