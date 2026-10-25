// A grader's grades (an eval with `trigger: runs`, core grades.ts): one per
// graded run, newest first, and what they add up to.
//
//   GET ?days=30&status=fail&limit=100
//     → { eval, flow, agent, sample, improve, since, summary, grades }
//
// `summary` is over the window (graded, passed, failed, errors, rate,
// costUsd, byDay); `grades` the newest `limit` (default 100, at most 500)
// of those, filtered by `status` (pass | fail | error) when given.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import { listEvals } from "@/lib/evals";
import { readGrades, summariseGrades } from "@/lib/grades";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const tenant = await requireTenant(req);
    const info = listEvals(tenant, workspace).find((e) => e.name === evalName);
    if (!info) throw new ApiError(`eval ${evalName} not found`, 404);
    if (info.trigger !== "runs") throw new ApiError(`${evalName} runs cases rather than grading runs — its results are at …/evals/${evalName}/run`, 400);
    const q = req.nextUrl.searchParams;
    const days = Math.min(Math.max(Math.floor(Number(q.get("days") ?? 30)) || 30, 1), 90);
    const limit = Math.min(Math.max(Math.floor(Number(q.get("limit") ?? 100)) || 100, 1), 500);
    const status = q.get("status");
    if (status && !["pass", "fail", "error"].includes(status)) throw new ApiError("status is pass, fail or error", 400);
    const grades = readGrades(tenant, workspace, evalName, { sinceMs: Date.now() - days * 86400_000 });
    return NextResponse.json({
      eval: info.name,
      flow: info.flow,
      agent: info.agent,
      sample: info.sample,
      improve: info.improve,
      days,
      summary: summariseGrades(grades),
      grades: grades.filter((g) => !status || g.status === status).slice(0, limit),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
