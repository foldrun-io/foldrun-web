// Approve or reject the steps a run is paused on, from the dashboard or an
// API key.
//
// The decision itself lives in core (approvals.ts) because the emailed link
// route makes the same one; this route contributes the caller's identity and
// the JSON shape the dashboard expects.
//
// `payload` releases a step parked on `wait: event` with what the person
// typed, as the run's event URL would — recorded as delivered by them, not
// by "an external event". Only for such a step: anywhere else it is a 400.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, ApiError } from "@/server/api";
import { decideApproval, deliverEvent } from "@/lib/approvals";
import { readRun } from "@/lib/store";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const body = (await req.json().catch(() => ({}))) as {
      decision?: "approve" | "reject";
      reason?: string;
      note?: string;
      step?: number;
      payload?: unknown;
    };
    const decision = body.decision === "reject" ? "reject" : "approve";

    if (body.payload !== undefined) {
      if (decision !== "approve") throw new ApiError("a payload releases a wait: event step — it cannot go with a reject", 400);
      const run = readRun(tenant, workspace, runId);
      if (!run) throw new ApiError("run not found", 404);
      const onEvent = run.steps
        .map((s, i) => ({ s, i }))
        .filter(({ s, i }) => s.status === "awaiting-approval" && s.waitFor === "event" && (body.step === undefined || body.step === i));
      if (onEvent.length === 0) {
        throw new ApiError(
          body.step === undefined
            ? "a payload is for a step waiting on wait: event, and this run has none waiting"
            : `step ${body.step} is not waiting on wait: event — a payload is only for such a step`,
          400,
        );
      }
      const text = typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload);
      if (text.length > 20_000) throw new ApiError("payload is at most 20000 characters", 400);
      const { steps } = await deliverEvent(tenant, workspace, runId, text, { by: `by ${actor.name}`, step: body.step });
      return NextResponse.json({ ok: true, decision, steps });
    }

    const { steps } = await decideApproval(tenant, workspace, runId, {
      decision,
      note: body.note,
      reason: body.reason,
      step: body.step,
      by: "by a human",
      // Who is deciding, so the flow's `approvers:` and the rule against
      // approving your own run have someone to check. A key is a caller,
      // not a person: it carries a role but no address, so it passes the
      // self-approval rule and only an `approvers:` list can stop it.
      // A key minted by a person carries their address as its name: it
      // decides as them, so their own run cannot be approved with their key.
      actor: actor.kind === "user" || !actor.name.startsWith("key:") ? { email: actor.name, role: actor.role } : { email: null, role: actor.role },
    });

    return NextResponse.json({ ok: true, decision, steps });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
