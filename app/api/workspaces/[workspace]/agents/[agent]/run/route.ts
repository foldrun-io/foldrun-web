import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, ApiError, refuse } from "@/server/api";
import fs from "node:fs";
import path from "node:path";
import { workspaceDir, isOneSegment } from "@/lib/store";
import { enqueueFlowRun } from "@/platform/queue";
import { wantsWait, waitAndRespond } from "@/server/wait";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; agent: string }> },
) {
  try {
    const { workspace, agent } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    // The name is one folder under agents/, never a path (30 Oct 2026): Next
    // decodes %2F in a segment, and `..%2F..%2F<tenant>%2F…` ran another
    // account's agent under this caller's run. The runner refuses it too.
    if (!isOneSegment(agent)) throw new ApiError(`invalid agent "${agent}" — an agent's folder name, not a path`, 400);
    if (!fs.existsSync(path.join(workspaceDir(tenant, workspace), "agents", agent, "agent.md"))) {
      return refuse(`agent ${agent} not found`, 404);
    }
    let task = "";
    let test: boolean | undefined;
    try {
      const body = await req.json();
      if (typeof body?.task === "string") task = body.task;
      if (typeof body?.test === "boolean") test = body.test;
    } catch {
      // empty body is fine
    }
    const run = await enqueueFlowRun(
      tenant,
      workspace,
      [{ agent, instruction: task, group: 1, optional: false }],
      `adhoc:${agent}`,
      undefined,
      [],
      null,
      { test },
    );
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    return NextResponse.json({ ok: true, runId: run.id, test: run.test === true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
