// Send one notify: delivery again, now: the same X-Foldrun-Delivery id and
// the same body, signed afresh, against the URL notify: names today. The
// attempt is added to the delivery's log. An accepted redelivery also
// switches a webhook that was turned off after days of failures back on.
//
// It POSTs to a URL outside the platform, so it needs the permission that
// runs, like the test button beside it.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { workspaceDir } from "@/lib/store";
import { redeliver } from "@/platform/webhook-deliveries";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; id: string }> }) {
  try {
    const { workspace, id } = await ctx.params;
    const { tenant } = await requirePermission(req, "run:start");
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return refuse(`no workspace "${workspace}"`, 404);
    }
    const delivery = await redeliver(tenant, workspace, id);
    if (!delivery) return refuse(`no delivery "${id}" in ${workspace}`, 404);
    const last = delivery.attemptLog[delivery.attemptLog.length - 1] ?? null;
    // 200 either way, like notify/test: the redelivery was made, and
    // whether the receiver took it is the answer, not an error of ours.
    return NextResponse.json({ ok: last?.statusCode !== null && last?.error === null, attempt: last, delivery });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts: a client that
 *  lost the answer and retries does not POST the receiver a second time. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
