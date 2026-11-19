import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, ApiError, refuse } from "@/server/api";
import fs from "node:fs";
import path from "node:path";
import { workspaceDir, isOneSegment, readRun } from "@/lib/store";
import { enqueueFlowRun } from "@/platform/queue";
import { wantsWait, waitAndRespond } from "@/server/wait";
import { idempotent } from "@/server/idempotency";
import { getSnapshot, SnapshotRefused } from "@/platform/snapshots";
import { contextIdProblem, messagesBlock, runContext, SESSION_MESSAGE_LIMITS, type SessionMessage } from "@/lib/conversation";
import { asRunMessage, claimedRunOf, claimSessionMessages, freeSessionMessages, SessionMessagesUnavailable } from "@/platform/session-messages";
import crypto from "node:crypto";
import { inputsFromBody, missingText } from "@/server/run-inputs";
import { customerProblem } from "@/lib/customer";
import { assertCustomerNamed } from "@/server/customer-required";
import { MissingInput } from "@/lib/storage";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; agent: string }> },
) {
  try {
    const { workspace, agent } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
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
    // Session messages (19 Nov 2026): waiting messages of this conversation
    // the caller chose to include in this turn.
    let messageIds: string[] | undefined;
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
      if (body?.messages !== undefined && body?.messages !== null) {
        if (!Array.isArray(body.messages) || body.messages.some((m: unknown) => typeof m !== "string" || !/^sm-[A-Za-z0-9_-]{1,40}$/.test(m))) {
          throw new ApiError("messages: the ids of waiting session messages to include (GET …/sessions/<context>/messages?waiting=1)", 400);
        }
        if (body.messages.length > SESSION_MESSAGE_LIMITS.perTurn) throw new ApiError(`messages: at most ${SESSION_MESSAGE_LIMITS.perTurn} in one turn`, 400);
        messageIds = body.messages as string[];
      }
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
    assertCustomerNamed(actor, customer);
    const inputs = inputsFromBody(tenant, workspace, rawInputs);
    if (messageIds?.length && !context) return refuse("messages: only a turn of a conversation includes them — give its `context`", 400);
    // Claimed for this turn before it is made, under a token: a message is
    // taken by one turn only. All or nothing — a turn never runs with fewer
    // than the person chose without saying so.
    let claim: { token: string; messages: SessionMessage[] } | undefined;
    let left: string[] = [];
    if (messageIds?.length && context) {
      const token = `claim-${crypto.randomUUID()}`;
      const { taken, refused } = await claimSessionMessages(tenant, workspace, context, messageIds, token);
      if (refused.length) {
        await freeSessionMessages(tenant, token);
        return NextResponse.json({ error: `${refused.length === 1 ? "a message is" : `${refused.length} messages are`} no longer waiting for ${context} — read them again (GET …/sessions/${context}/messages?waiting=1); nothing was started`, refused }, { status: 409 });
      }
      // What fits in the turn's block goes in; the rest waits again and the
      // answer says so (`left`) — none is marked used that the agent did not
      // read (Codex, 19 Nov 2026).
      const all = taken.map(asRunMessage);
      const fit = messagesBlock(all)?.given ?? 0;
      left = all.slice(fit).map((m) => m.id);
      if (left.length) await freeSessionMessages(tenant, token, { ids: left });
      if (!fit) return NextResponse.json({ error: "messages: none of them fits in one turn — nothing was started", left }, { status: 413 });
      claim = { token, messages: all.slice(0, fit) };
    }
    let run;
    try {
      run = await enqueueFlowRun(
      tenant,
      workspace,
      [{ agent, instruction: task, group: 1, optional: false }],
      `adhoc:${agent}`,
      undefined,
      [],
      null,
      { test, ...(snapshot ? { snapshot } : {}), ...(context ? { conversation: { context: runContext(context), input: { text: task } } } : {}), ...(inputs ? { inputs } : {}), ...(customer ? { customer } : {}), ...(claim ? { sessionMessages: { claim: claim.token, messages: claim.messages } } : {}) },
      );
    } catch (err) {
      // Bound inside the queue before the run is queued. Freed again only
      // when no run holds them — never when it was queued and something
      // after failed, so a retry cannot hand them to a second turn.
      if (claim) {
        const token = claim.token;
        await (async () => {
          const bound = await claimedRunOf(tenant, token);
          if (bound && readRun(tenant, workspace, bound)) return;
          await freeSessionMessages(tenant, token, { bound: true });
        })().catch(() => {});
      }
      throw err;
    }
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run, { ...(run.sessionMessages?.length ? { messages: run.sessionMessages.map((m) => m.id) } : {}), ...(left.length ? { left } : {}) });
    return NextResponse.json({ ok: true, runId: run.id, test: run.test === true, ...(run.snapshot ? { snapshot: run.snapshot.id } : {}), ...(run.context ? { context: run.context.id } : {}), ...(run.inputs?.length ? { inputs: run.inputs.map((f) => f.path) } : {}), ...(run.customer ? { customer: run.customer } : {}), ...(run.sessionMessages?.length ? { messages: run.sessionMessages.map((m) => m.id) } : {}), ...(left.length ? { left } : {}) });
  } catch (err) {
    if (err instanceof SessionMessagesUnavailable) return refuse(err.message, 503);
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
