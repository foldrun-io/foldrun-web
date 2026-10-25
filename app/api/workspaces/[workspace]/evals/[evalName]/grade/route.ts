// Grade one finished run now, whether or not it was sampled — a person
// trying a new grader on a run they know, or asking again after a fix.
//
//   POST { run } → the grade (core grades.ts Grade), kept like any other:
//                  a run graded again has its newer grade shown.
//
// The judges run on the account's own model key, like an eval's. A run that
// is not this grader's (another flow, or none of its agent's steps) is a
// 400; one still going is a 409.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, ApiError } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { adminState, pauseOf } from "@/platform/admin";
import { listEvals } from "@/lib/evals";
import { readRun, assertSafeName } from "@/lib/store";
import { gradeRun, recordGrade } from "@/lib/grades";

export const maxDuration = 300;

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const body = (await req.json().catch(() => ({}))) as { run?: unknown };
    if (typeof body.run !== "string" || !body.run.trim()) throw new ApiError("expected { run } — the id of a finished run to grade", 400);
    assertSafeName(body.run, "run id");
    // The kill switch holds here too: a judge or a draft is paid work, and
    // neither goes through the run queue that refuses a paused workspace.
    const halt = pauseOf(await adminState(tenant), workspace);
    if (halt) throw new ApiError(`${halt.scope === "account" ? "the account" : "this workspace"} is paused — resume it first`, 409);
    const info = listEvals(tenant, workspace).find((e) => e.name === evalName);
    if (!info) throw new ApiError(`eval ${evalName} not found`, 404);
    const run = readRun(tenant, workspace, body.run);
    if (!run) throw new ApiError(`run ${body.run} not found`, 404);
    const grade = await gradeRun(tenant, workspace, info, run, { by: actor.name });
    recordGrade(tenant, workspace, grade);
    return NextResponse.json(grade);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
