import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, ApiError, refuse } from "@/server/api";
import fs from "node:fs";
import path from "node:path";
import { workspaceDir, isOneSegment } from "@/lib/store";
import { enqueueFlowRun } from "@/platform/queue";
import { wantsWait, waitAndRespond } from "@/server/wait";
import { idempotent } from "@/server/idempotency";
import { getSnapshot, SnapshotRefused } from "@/platform/snapshots";
import { contextIdProblem, runContext } from "@/lib/conversation";
import { inputsFromBody, missingText } from "@/server/run-inputs";
import { customerProblem } from "@/lib/customer";
import { MissingInput } from "@/lib/storage";

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
    let snapshot: string | undefined;
    // FOL-162: the conversation this run is a turn of (conversation.ts).
    let context: string | undefined;
    // FOL-163: storage paths the agent is handed, at agents/<name>/inputs/.
    let rawInputs: unknown;
    // FOL-168: which of the partner's own users this run is for.
    let customer: string | undefined;
    try {
      const body = await req.json();
      if (typeof body?.task === "string") task = body.task;
      if (typeof body?.test === "boolean") test = body.test;
      if (body?.snapshot !== undefined) {
        if (typeof body.snapshot !== "string" || !/^[0-9a-f]{64}$/.test(body.snapshot)) throw new ApiError("snapshot: the id POST …/snapshots answered (64 hex characters)", 400);
        snapshot = body.snapshot;
      }
      if (body?.context !== undefined && body?.context !== null) {
        const problem = contextIdProblem(body.context);
        if (problem) throw new ApiError(problem, 400);
        context = body.context as string;
      }
      rawInputs = body?.inputs;
      if (body?.customer !== undefined && body?.customer !== null) {
        const problem = customerProblem(body.customer);
        if (problem) throw new ApiError(problem, 400);
        customer = body.customer as string;
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // empty body is fine
    }
    // A folder to work on (Part B3): only where a step runs in a sandbox that
    // can hold one, and only this workspace's own — then pinned to the run
    // before any worker can see it (platform queue.ts).
    if (snapshot) {
      if (process.env.FOLDRUN_RUN_ISOLATION !== "k8s") return refuse("this install runs steps without the sandbox a snapshot needs (FOLDRUN_RUN_ISOLATION=k8s) — nothing was started", 409);
      if (!(await getSnapshot(tenant, workspace, snapshot))) return refuse(`no snapshot ${snapshot.slice(0, 12)}… in ${workspace} — send the folder again (foldrun snapshot push)`, 404);
    }
    const inputs = inputsFromBody(tenant, workspace, rawInputs);
    const run = await enqueueFlowRun(
      tenant,
      workspace,
      [{ agent, instruction: task, group: 1, optional: false }],
      `adhoc:${agent}`,
      undefined,
      [],
      null,
      { test, ...(snapshot ? { snapshot } : {}), ...(context ? { conversation: { context: runContext(context), input: { text: task } } } : {}), ...(inputs ? { inputs } : {}), ...(customer ? { customer } : {}) },
    );
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    return NextResponse.json({ ok: true, runId: run.id, test: run.test === true, ...(run.snapshot ? { snapshot: run.snapshot.id } : {}), ...(run.context ? { context: run.context.id } : {}), ...(run.inputs?.length ? { inputs: run.inputs.map((f) => f.path) } : {}), ...(run.customer ? { customer: run.customer } : {}) });
  } catch (err) {
    // The folder went between the check and the pin: the run was undone.
    if (err instanceof SnapshotRefused) return refuse(err.message, 404);
    // An input deleted between the check and the hold: the run was undone.
    if (err instanceof MissingInput) return refuse(missingText("this workspace", err.path), 404);
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
