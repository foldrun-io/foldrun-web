// Turn a finished run into a regression case. The run's task and conclusion
// are already on record; this writes them into evals/<target>-regressions.md
// (or the `evalName` given), appending when the file exists. Optional
// `caseName`, and `expect` — assertion lines in the eval syntax, e.g.
// ["contains: $34", "judge: names the buyer"] — replace the default judge
// line that holds the next run to the recorded conclusion.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, actorOf, requirePermission, ApiError } from "@/server/api";
import { promoteRunToEval } from "@/lib/evals";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const body = (await req.json().catch(() => ({}))) as {
      evalName?: unknown;
      caseName?: unknown;
      expect?: unknown;
      should?: unknown;
    };
    const str = (v: unknown, name: string) => {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v !== "string") throw new ApiError(`${name} must be a string`, 400);
      return v;
    };
    if (
      body.expect !== undefined &&
      (!Array.isArray(body.expect) || body.expect.some((e) => typeof e !== "string"))
    ) {
      return NextResponse.json({ error: "expect must be an array of assertion lines" }, { status: 400 });
    }
    const result = promoteRunToEval(tenant, workspace, runId, {
      evalName: str(body.evalName, "evalName"),
      caseName: str(body.caseName, "caseName"),
      expect: body.expect as string[] | undefined,
      // A run that went wrong: what it should have done (FOL-72 step 10).
      should: str(body.should, "should"),
      by: await actorOf(req),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
