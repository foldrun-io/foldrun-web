// Compare models on one eval (core eval-compare.ts): its cases under two to
// four settings, `repeat` times each, side by side.
//
//   POST { configs: [{ model, effort?, agent? }], repeat?, maxUsd? }
//        → 202 { started, eval, runId, startedAt, trials, maxUsd }
//   GET ?run=<id>   that comparison: running (with progress) | done (its
//                   result) | failed | lost | unavailable
//   GET             who holds it now, and the kept comparisons, newest first
//
// Always async: it runs as many case runs as the plan says, which is minutes
// at the least. Every run is a test run; the result is the comparison's own
// file (evals/.results/compare/<eval>/<id>.json), never the eval's latest
// result. One comparison of an eval at a time; a second is a 409.

import { NextRequest, NextResponse, after } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { listEvals } from "@/lib/evals";
import { planComparison, compareEval } from "@/lib/eval-compare";
import { claimEvalCompare, readEvalCompare, currentEvalCompare, pastEvalCompares } from "@/server/eval-runs";

export const maxDuration = 800;

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const info = listEvals(tenant, workspace).find((e) => e.name === evalName);
    if (!info) return NextResponse.json({ error: `eval ${evalName} not found` }, { status: 404 });
    const plan = planComparison(info, await req.json().catch(() => null));
    const claim = await claimEvalCompare(tenant, workspace, evalName);
    if (!claim) {
      const holder = await currentEvalCompare(tenant, workspace, evalName);
      return NextResponse.json(
        { error: `a comparison of ${evalName} is already running${holder ? ` (${holder.runId}, since ${holder.startedAt})` : ""} — poll GET …/evals/${evalName}/compare${holder ? `?run=${holder.runId}` : ""}`, ...(holder ?? {}) },
        { status: 409 },
      );
    }
    // after(): tracked by the server, so a graceful shutdown lets it finish.
    after(async () => {
      try {
        const result = await compareEval(tenant, workspace, info, plan, { onProgress: (done, total) => claim.progress(done, total) });
        await claim.finish({ result });
      } catch (err) {
        console.error(`[foldrun] comparison ${tenant}/${workspace}/${evalName} failed:`, err);
        await claim.finish({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    return NextResponse.json(
      { started: true, eval: evalName, runId: claim.runId, startedAt: claim.startedAt, trials: plan.trials, maxUsd: plan.maxUsd },
      { status: 202 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!listEvals(tenant, workspace).some((e) => e.name === evalName)) return NextResponse.json({ error: `eval ${evalName} not found` }, { status: 404 });
    const runId = req.nextUrl.searchParams.get("run");
    if (runId) {
      const view = await readEvalCompare(tenant, workspace, evalName, runId);
      return NextResponse.json({ ...view, running: view.state === "running" });
    }
    const holder = await currentEvalCompare(tenant, workspace, evalName);
    return NextResponse.json({
      running: !!holder,
      ...(holder ?? {}),
      comparisons: pastEvalCompares(tenant, workspace, evalName),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
