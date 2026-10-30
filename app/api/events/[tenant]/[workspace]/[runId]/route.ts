// Release a run parked on `wait: event`. POST here with whatever the outside
// world has to say — a reply, a payment, a "done" — and the waiting step
// runs with that body as its event payload.
//
// The URL carries a token derived from the run's identity under the
// install's secret key (see webhook.ts), so a run's event URL can be handed
// to a third party without storing anything, and rotating the key ends
// every outstanding one at once. Unauthenticated apart from that token, like
// a flow's hook URL: the caller is a machine somewhere, not a member.

import { errorResponse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { clientIp, refuseWhenLimited, sameToken, BAD_CALLBACK_TOKENS } from "@/server/limits";
import { eventToken } from "@/lib/webhook";
import { deliverEvent } from "@/lib/approvals";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; workspace: string; runId: string }> },
) {
  try {
    const { tenant, workspace, runId } = await ctx.params;
    const presented = req.nextUrl.searchParams.get("token") ?? "";
    const expected = eventToken(tenant, workspace, runId);
    if (!sameToken(presented, expected)) {
      // The wrong-token limit hooks and inboxes keep, under its own key: an
      // event URL had none until 30 Oct 2026. Counted only when refused, so a
      // stranger cannot throttle a real release.
      const ip = clientIp(req);
      const limited = ip ? await refuseWhenLimited(`event-refused:${ip}`, BAD_CALLBACK_TOKENS.limit, BAD_CALLBACK_TOKENS.windowSec) : null;
      if (limited) return limited;
      return NextResponse.json({ error: "invalid token" }, { status: 401 });
    }

    const payload = (await req.text()).slice(0, 20_000);
    const { steps } = await deliverEvent(tenant, workspace, runId, payload);
    return NextResponse.json({ ok: true, runId, steps });
  } catch (err) {
    return errorResponse(err);
  }
}
