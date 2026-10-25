// Run one eval. Synchronous by default: an eval is something you wait for —
// in CI, or watching the page — and its whole value is the verdict at the
// end, not a live trace. Each case's underlying agent run is recorded
// normally, so the detail is still there if you want it.
//
//   POST                     run it and answer with the result
//   POST { async: true }     202 { runId, startedAt } at once; the eval runs on
//   GET ?run=<id>            that run: running | done (its result) | failed | lost | unavailable
//   GET                      who holds the eval now, and the latest result
//
// Async because an eval of slow cases outlives a proxy: Cloudflare answers
// 524 after its read timeout (125 s by default) while the eval goes on, and
// the caller learned nothing. server/eval-runs.ts has the run records.

import { NextRequest, NextResponse, after } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { listEvals, runEval, writeEvalResult, readEvalResult } from "@/lib/evals";
import { claimEvalRun, readEvalRun, currentEvalRun } from "@/server/eval-runs";
import { idempotent } from "@/server/idempotency";

export const maxDuration = 800;

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; evalName: string }> },
) {
  try {
    const { workspace, evalName } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;

    const info = listEvals(tenant, workspace).find((e) => e.name === evalName);
    if (!info) return NextResponse.json({ error: `eval ${evalName} not found` }, { status: 404 });
    if (info.inputs) {
      return NextResponse.json({ error: `${evalName} is a file of saved inputs, not an eval — run its flow with one instead` }, { status: 400 });
    }
    if (info.trigger === "runs") {
      return NextResponse.json({ error: `${evalName} grades real runs (trigger: runs) — it has no cases to run; POST …/evals/${evalName}/grade { run } grades one now` }, { status: 400 });
    }
    if (info.cases.length === 0) {
      return NextResponse.json({ error: `eval ${evalName} has no cases` }, { status: 400 });
    }

    // Read before the claim: nothing between taking it and the run may throw.
    const raw: unknown = await req.json().catch(() => null);
    const wantsAsync = !!raw && typeof raw === "object" && (raw as { async?: unknown }).async === true;
    const claim = await claimEvalRun(tenant, workspace, evalName);
    if (!claim) {
      const holder = await currentEvalRun(tenant, workspace, evalName);
      return NextResponse.json(
        { error: `${evalName} is already running${holder ? ` (run ${holder.runId}, since ${holder.startedAt})` : ""} — poll GET …/evals/${evalName}/run${holder ? `?run=${holder.runId}` : ""}`, ...(holder ?? {}) },
        { status: 409 },
      );
    }
    const run = async () => {
      try {
        const result = await runEval(tenant, workspace, info);
        writeEvalResult(tenant, workspace, result);
        await claim.finish({ result });
        return result;
      } catch (err) {
        await claim.finish({ error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    };
    if (wantsAsync) {
      // after(): tracked by the server, so a graceful shutdown lets it finish
      // (Next.js self-hosting docs) — a bare promise would not be waited for.
      after(() => run().catch((err) => console.error(`[foldrun] eval ${tenant}/${workspace}/${evalName} failed:`, err)));
      return NextResponse.json({ started: true, eval: evalName, runId: claim.runId, startedAt: claim.startedAt }, { status: 202 });
    }
    return NextResponse.json(await run());
  } catch (err) {
    return errorResponse(err);
  }
}

/** One run by id (what an async caller polls), or the eval's current holder and latest result. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; evalName: string }> }) {
  try {
    const { workspace, evalName } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!listEvals(tenant, workspace).some((e) => e.name === evalName)) return NextResponse.json({ error: `eval ${evalName} not found` }, { status: 404 });
    const runId = req.nextUrl.searchParams.get("run");
    if (runId) {
      const view = await readEvalRun(tenant, workspace, evalName, runId);
      return NextResponse.json({ ...view, running: view.state === "running" });
    }
    const holder = await currentEvalRun(tenant, workspace, evalName);
    return NextResponse.json({
      running: !!holder,
      ...(holder ?? {}),
      result: readEvalResult(tenant, workspace, evalName),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
