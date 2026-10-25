// `?wait=true` — turn a run into a request/response call.
//
// Starting a run and returning a receipt is right for a schedule and wrong for
// a caller putting an agent behind their own endpoint: they want the answer.
// One definition, shared by the flow and agent run routes, so the two cannot
// disagree about what a waited run returns.

import { NextResponse, type NextRequest } from "next/server";
import { waitForRun, runResult } from "@/lib/runner";
import { runCost, type RunRecord } from "@/lib/store";

/** Long enough for a real multi-step flow, short enough to not hold forever. */
const DEFAULT_TIMEOUT_S = 300;
const MAX_TIMEOUT_S = 900;

export function wantsWait(req: NextRequest): boolean {
  const v = req.nextUrl.searchParams.get("wait");
  return v === "" || v === "1" || v === "true";
}

function timeoutMs(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("timeout"));
  const secs = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
  return secs * 1000;
}

/**
 * Block until the run stops, then answer with what it produced.
 *
 * The status codes are the point. A caller scripting against this needs to
 * tell apart "the agent answered", "the agent failed", "a person has to
 * approve something", and "it is still going" — and only the first is a 200.
 */
export async function waitAndRespond(
  req: NextRequest,
  tenant: string,
  workspace: string,
  started: RunRecord,
) {
  const { run, timedOut } = await waitForRun(tenant, workspace, started.id, timeoutMs(req));
  if (!run) {
    return NextResponse.json({ ok: false, runId: started.id, error: "run vanished" }, { status: 500 });
  }

  const body = {
    ok: run.status === "completed",
    runId: run.id,
    status: run.status,
    result: runResult(run),
    costUsd: runCost(run),
    steps: run.steps.map((s) => ({
      agent: s.agent,
      status: s.status,
      skipReason: s.skipReason ?? null,
    })),
  };

  // 202: started, not finished. Both cases are the caller's to handle rather
  // than a failure of ours — the run is still on disk and still readable at
  // /runs/{id}, which is what makes this safe to return early.
  if (timedOut) {
    return NextResponse.json({ ...body, timedOut: true }, { status: 202 });
  }
  if (run.status === "awaiting-approval") {
    return NextResponse.json({ ...body, awaitingApproval: true }, { status: 202 });
  }
  return NextResponse.json(body, { status: run.status === "completed" ? 200 : 500 });
}
