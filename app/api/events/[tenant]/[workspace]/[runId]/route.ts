// Release a run parked on `wait: event`. POST here with whatever the outside
// world has to say — a reply, a payment, a "done" — and the waiting step
// runs with that body as its event payload.
//
// The URL carries a token derived from the run's identity under the
// install's secret key (see webhook.ts), so a run's event URL can be handed
// to a third party without storing anything, and rotating the key ends
// every outstanding one at once. Unauthenticated apart from that token, like
// a flow's hook URL: the caller is a machine somewhere, not a member.
//
// Since 30 Oct 2026 the token is one step's, for one park (`&step=<index>`,
// core approvals.ts eventGatesFor): it releases that step and nothing after
// it, and stops working once the step is released. The per-run form URLs
// carried before then still releases a step parked under it.

import { errorResponse, refuse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { clientIp, refuseWhenLimited, BAD_CALLBACK_TOKENS } from "@/server/limits";
import { deliverEvent, eventGatesFor } from "@/lib/approvals";
import { readRun } from "@/lib/store";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; workspace: string; runId: string }> },
) {
  try {
    const { tenant, workspace, runId } = await ctx.params;
    const presented = req.nextUrl.searchParams.get("token") ?? "";
    const rawStep = req.nextUrl.searchParams.get("step");
    const step = rawStep !== null && /^\d{1,4}$/.test(rawStep) ? Number(rawStep) : null;
    // A run that is not there, a name the store refuses and a wrong token
    // are one answer: the token is the only credential, and a stranger
    // learns nothing about which runs exist.
    let run: ReturnType<typeof readRun> = null;
    try {
      run = readRun(tenant, workspace, runId);
    } catch {
      run = null;
    }
    const opened = run && (rawStep === null || step !== null) ? eventGatesFor(tenant, workspace, run, presented, step) : null;
    if (!opened?.known) {
      // The wrong-token limit hooks and inboxes keep, under its own key: an
      // event URL had none until 30 Oct 2026. Counted only when refused, so a
      // stranger cannot throttle a real release.
      const ip = clientIp(req);
      const limited = ip ? await refuseWhenLimited(`event-refused:${ip}`, BAD_CALLBACK_TOKENS.limit, BAD_CALLBACK_TOKENS.windowSec) : null;
      if (limited) return limited;
      return refuse("invalid token", 401);
    }
    // A real URL whose gate is over — released already, or parked again
    // under a new URL — is the 409 a run not waiting has always been.
    if (!opened.steps.length) {
      return refuse("this run is not waiting for an event at this URL", 409);
    }
    const gates = opened.steps;

    const payload = (await req.text()).slice(0, 20_000);
    let steps: number[] = [];
    for (const gate of gates) {
      steps = steps.concat((await deliverEvent(tenant, workspace, runId, payload, { step: gate })).steps);
    }
    return NextResponse.json({ ok: true, runId, steps });
  } catch (err) {
    return errorResponse(err);
  }
}
