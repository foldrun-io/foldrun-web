// Say something to a running agent. The message waits in the step's inbox
// and reaches the model after its next tool call, as context — it never
// changes the step's tools or permissions. Only a running step can be
// written to: a finished one has nobody to read it.
//
// Which step: `step` (its index in run.steps). Left out, the only running
// step; with several running (a parallel group) and none named, 400 listing
// them — a message meant for one must not be read by its sibling.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, errorResponse, requirePermission, refuse } from "@/server/api";
import { readRun } from "@/lib/store";
import { MESSAGE_MAX, postMessage } from "@/platform/operator-store";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string }> }) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const body = (await req.json().catch(() => ({}))) as { text?: unknown; step?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return refuse("expected { text, step? }", 400);
    if (text.length > MESSAGE_MAX) return refuse(`a message is at most ${MESSAGE_MAX} characters`, 413);
    const run = readRun(tenant, workspace, runId);
    if (!run) return refuse("run not found", 404);
    if (run.status !== "running") {
      return refuse(`the run is ${run.status} — only a running step can be written to`, 409);
    }
    const running = run.steps.flatMap((s, i) => (s.status === "running" ? [{ step: i, agent: s.agent }] : []));
    let step: number;
    if (body.step !== undefined && body.step !== null) {
      const n = typeof body.step === "number" ? body.step : typeof body.step === "string" && /^\d+$/.test(body.step) ? Number(body.step) : NaN;
      if (!Number.isInteger(n) || n < 0 || n >= run.steps.length) {
        return NextResponse.json({ error: `no step ${String(body.step)} in this run`, running }, { status: 400 });
      }
      if (run.steps[n].status !== "running") {
        return NextResponse.json({ error: `step ${n} (${run.steps[n].agent}) is ${run.steps[n].status} — only a running step can be written to`, running }, { status: 409 });
      }
      step = n;
    } else if (running.length === 1) {
      step = running[0].step;
    } else if (running.length === 0) {
      return NextResponse.json({ error: "no step is running right now — try again once one starts", running }, { status: 409 });
    } else {
      return NextResponse.json(
        { error: `${running.length} steps are running — say which with { step }: ${running.map((r) => `${r.step} (${r.agent})`).join(", ")}`, running },
        { status: 400 },
      );
    }
    // One step running: the run-level inbox, which that step reads whatever
    // its lease carries. Several: the step's own inbox, which only a lease
    // naming that step reads — so a sibling never takes it.
    const message = await postMessage(tenant, runId, text, await actorOf(req), running.length > 1 ? step : undefined);
    return NextResponse.json({ ok: true, step, message });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
