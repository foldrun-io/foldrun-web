// A2A — serving published flows to outside agents (1 Nov 2026). The routes
// under app/a2a/ call these; server/a2a-protocol.ts is the wire.
//
// Every call is an A2A key's (auth.ts resolveA2aKey): Bearer only, no
// session, no API key. Every lookup checks the account, the workspace, the
// flow (granted to the key AND published, read now) and — for a task — the
// key's principal; anything else is "not found", never "not yours".
//
// SendMessage writes the task before it starts the run (platform
// a2a-tasks.ts), so a retried message finds its task and starts nothing, and
// starts the run through the same admission as the run route (platform
// flow-admission.ts): pause, money, budget, plan limits and `overlap: skip`
// hold for an outside agent exactly as for a person. An approval gate or a
// question to a person stays with the workspace's people: the task shows
// WORKING, "waiting for a person", and no A2A call can decide either.

import { runContext } from "@/lib/conversation";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { loadFlow } from "@/lib/runner";
import { listFlows, readRun, workspaceDir, type FlowInfo, type RunRecord } from "@/lib/store";
import { isA2aPublished, type A2aPublication } from "@/lib/a2a-publish";
import { admitFlowRun, AdmissionRefused, withAdmissionLock } from "@/platform/flow-admission";
import { stopRun } from "@/platform/queue";
import {
  bindA2aTaskRun,
  claimA2aTask,
  dropA2aTask,
  getA2aTask,
  listA2aTasks,
  noteA2aTaskState,
  openA2aTasks,
  retakeA2aTask,
  recoverA2aTaskRun,
  runOfA2aTask,
  TERMINAL_STATES,
  type A2aTask,
  type A2aTaskState,
} from "@/platform/a2a-tasks";
import { resolveA2aKey, listApiKeys, type A2aCaller } from "./auth.ts";
import { publicOrigin } from "./auth-flows.ts";
import { reportError } from "./api.ts";
import { opsLog } from "@/lib/ops-log.ts";
import { sandboxSecrets, unacceptedExposures, workspaceA2aTree } from "./workspace-policy.ts";
import { secretCodeExposures } from "@/lib/a2a-reach";
import { clientIp } from "./limits.ts";
import { rateLimit } from "@/platform/cache";
import {
  A2A_BODY_BYTES,
  A2A_PROTOCOL_VERSION,
  A2aError,
  RPC,
  STALE_CLAIM_MS,
  UNSERVED_METHODS,
  a2aUrls,
  agentCard,
  invalidParams,
  messageFingerprint,
  pageToken,
  parseRpc,
  projectTask,
  readPageToken,
  readSendParams,
  readStateFilter,
  requestInstruction,
  rpcErrorBody,
  rpcResultBody,
  taskNotFound,
  versionProblem,
  type RpcId,
  type TaskJson,
} from "./a2a-protocol.ts";

/** How long a blocking SendMessage waits for the run to end before it
 *  answers with the task as it stands (the caller then polls GetTask). */
const WAIT_MS = () => Math.max(0, Math.min(120_000, Number(process.env.FOLDRUN_A2A_WAIT_MS ?? 25_000) || 0));
const POLL_MS = () => Math.max(20, Number(process.env.FOLDRUN_A2A_POLL_MS ?? 500) || 500);

const HEADERS = { "a2a-version": A2A_PROTOCOL_VERSION, "cache-control": "no-store" } as const;

// ------------------------------------------------------------------ who may

interface Target {
  tenant: string;
  workspace: string;
  flow: FlowInfo;
  pub: A2aPublication;
}

/** The flow, if this caller may reach it now: its key's account and
 *  workspace, a flow its grant names, and that flow published. Null for
 *  every other case alike. */
function reachable(caller: A2aCaller | null, tenant: string, workspace: string, flowName: string): Target | null {
  if (caller && (caller.tenant !== tenant || caller.grant.workspace !== workspace || !caller.grant.flows.includes(flowName))) return null;
  let flow: FlowInfo | null = null;
  try {
    flow = loadFlow(tenant, workspace, flowName);
  } catch {
    return null; // a name that is not one, a workspace that is not there
  }
  const pub = flow?.a2a;
  if (!flow || flow.name !== flowName || !isA2aPublished(pub)) return null;
  return { tenant, workspace, flow, pub };
}

/** A refusal at the HTTP layer, in JSON-RPC's shape (the caller's client
 *  reads `error` either way). 401s say how to authenticate. */
function refusal(status: number, message: string, reason: string, id: RpcId = null): NextResponse {
  const err = new A2aError(RPC.SERVER_ERROR, message, { reason, httpStatus: status });
  return NextResponse.json(rpcErrorBody(id, err), {
    status,
    headers: { ...HEADERS, ...(status === 401 ? { "www-authenticate": 'Bearer realm="a2a"' } : {}) },
  });
}

const NOT_FOUND = () => refusal(404, "no agent here for this key — check the URL, and that the flow is published and named by your A2A key", "AGENT_NOT_FOUND");

async function caller(req: NextRequest): Promise<{ ok: true; caller: A2aCaller } | { ok: false; res: NextResponse }> {
  const got = await resolveA2aKey(req);
  if (!got.ok) return { ok: false, res: refusal(got.status, got.message, got.status === 401 ? "UNAUTHENTICATED" : "PERMISSION_DENIED") };
  return got;
}

// ------------------------------------------------------------------ the card

/** The card's version: a digest of the flow file, so it changes when what
 *  the card says (or the flow behind it) does. */
function cardVersion(t: Target): string {
  try {
    const text = fs.readFileSync(path.join(workspaceDir(t.tenant, t.workspace), "flows", t.flow.file), "utf8");
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
  } catch {
    return "0";
  }
}

/** Reads of a public card served with no key, a minute: per caller address
 *  when the proxy in front reports one honestly (limits.ts clientIp, only
 *  with FOLDRUN_TRUST_PROXY), else per card for every anonymous reader
 *  together. A card is cacheable for five minutes, so a client that honours
 *  Cache-Control or the ETag never comes near either. */
export const PUBLIC_CARD_LIMITS = { perIp: 60, perCard: 600, windowSec: 60 } as const;

async function publicCardLimited(req: NextRequest, t: Target): Promise<NextResponse | null> {
  const ip = clientIp(req);
  const verdict = ip
    ? await rateLimit(`a2a-card:ip:${ip}`, PUBLIC_CARD_LIMITS.perIp, PUBLIC_CARD_LIMITS.windowSec)
    : await rateLimit(`a2a-card:card:${JSON.stringify([t.tenant, t.workspace, t.flow.name])}`, PUBLIC_CARD_LIMITS.perCard, PUBLIC_CARD_LIMITS.windowSec);
  if (verdict.allowed) return null;
  const err = new A2aError(RPC.SERVER_ERROR, `too many reads of this card — it is cacheable for five minutes; retry in ${verdict.retryAfter}s`, { reason: "RATE_LIMITED", httpStatus: 429 });
  return NextResponse.json(rpcErrorBody(null, err), { status: 429, headers: { ...HEADERS, "retry-after": String(verdict.retryAfter) } });
}

/** GET …/flows/<flow>/.well-known/agent-card.json */
export async function serveCard(req: NextRequest, p: { tenant: string; workspace: string; flow: string }): Promise<Response> {
  try {
    // A public card is read without a key; a private one needs a key that
    // names the flow. Either way an unpublished flow has no card at all —
    // and without a key every other card is the same 401, so a stranger
    // cannot tell a private card from no card.
    const open = reachable(null, p.tenant, p.workspace, p.flow);
    let target: Target | null = open && open.pub.publicCard ? open : null;
    if (target) {
      // Served with no key checked: the proxy's rate gate counts only a
      // credential it can name, so this door has its own, cheap, limit.
      const limited = await publicCardLimited(req, target);
      if (limited) return limited;
    }
    if (!target) {
      const who = await caller(req);
      if (!who.ok) return who.res;
      target = reachable(who.caller, p.tenant, p.workspace, p.flow);
      if (!target) return NOT_FOUND();
    }
    const card = agentCard({ origin: publicOrigin(req), tenant: p.tenant, workspace: p.workspace, flow: target.flow, pub: target.pub, version: cardVersion(target) });
    const body = JSON.stringify(card);
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 20)}"`;
    const cache = target.pub.publicCard ? "public, max-age=300" : "private, max-age=60";
    const headers = { "content-type": "application/json", "cache-control": cache, etag, vary: "Authorization" };
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    reportError(err);
    return refusal(500, "something went wrong on our side", "INTERNAL");
  }
}

// ----------------------------------------------------------------- the index

/** GET /a2a/<account>/<workspace> — the flows this key may call, published. */
export async function serveIndex(req: NextRequest, p: { tenant: string; workspace: string }): Promise<Response> {
  try {
    const who = await caller(req);
    if (!who.ok) return who.res;
    const c = who.caller;
    if (c.tenant !== p.tenant || c.grant.workspace !== p.workspace) return NOT_FOUND();
    const origin = publicOrigin(req);
    const agents = c.grant.flows
      .map((f) => reachable(c, p.tenant, p.workspace, f))
      .filter((t): t is Target => t !== null)
      .map((t) => {
        const urls = a2aUrls(origin, p.tenant, p.workspace, t.flow.name);
        return { flow: t.flow.name, name: t.pub.name ?? t.flow.name, description: t.pub.description ?? t.flow.description ?? null, card: urls.card, url: urls.endpoint };
      });
    return NextResponse.json({ agents }, { headers: { ...HEADERS, "cache-control": "private, no-store" } });
  } catch (err) {
    reportError(err);
    return refusal(500, "something went wrong on our side", "INTERNAL");
  }
}

// ---------------------------------------------------------------- JSON-RPC

interface Ctx {
  target: Target;
  caller: A2aCaller;
  principal: string;
}

/** POST …/flows/<flow> — one JSON-RPC 2.0 call. */
export async function serveRpc(req: NextRequest, p: { tenant: string; workspace: string; flow: string }): Promise<Response> {
  let id: RpcId = null;
  try {
    const who = await caller(req);
    if (!who.ok) return who.res;
    const target = reachable(who.caller, p.tenant, p.workspace, p.flow);
    if (!target) return NOT_FOUND();
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > A2A_BODY_BYTES) {
      return NextResponse.json(rpcErrorBody(null, new A2aError(RPC.INVALID_REQUEST, `Request payload validation error: the body is over ${A2A_BODY_BYTES} bytes`)), { status: 413, headers: HEADERS });
    }
    const parsed = parseRpc(text);
    if (!parsed.ok) return NextResponse.json(rpcErrorBody(parsed.id, parsed.err), { headers: HEADERS });
    id = parsed.req.id;
    const bad = versionProblem(req.headers.get("a2a-version"), req.nextUrl.searchParams.get("A2A-Version"));
    if (bad) return NextResponse.json(rpcErrorBody(id, bad), { headers: HEADERS });
    const params = parsed.req.params;
    // `tenant` is a param of every request in 1.0; this endpoint is one
    // account's already, so a different one is a mistake, not a switch.
    if (params.tenant !== undefined && params.tenant !== "" && params.tenant !== p.tenant) throw invalidParams("tenant does not match this agent's", "tenant");
    const ctx: Ctx = { target, caller: who.caller, principal: who.caller.grant.principal };
    const result = await dispatch(ctx, parsed.req.method, params);
    return NextResponse.json(rpcResultBody(id, result), { headers: HEADERS });
  } catch (err) {
    if (err instanceof A2aError) return NextResponse.json(rpcErrorBody(id, err), { status: err.httpStatus, headers: HEADERS });
    reportError(err);
    return NextResponse.json(rpcErrorBody(id, new A2aError(RPC.INTERNAL_ERROR, "Internal error")), { headers: HEADERS });
  }
}

async function dispatch(ctx: Ctx, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "SendMessage":
      return sendMessage(ctx, params);
    case "GetTask":
      return getTask(ctx, params);
    case "ListTasks":
      return listTasks(ctx, params);
    case "CancelTask":
      return cancelTask(ctx, params);
  }
  // Own keys only: a method named like an Object.prototype member
  // (toString, constructor, __proto__) is not a method of ours.
  if (Object.hasOwn(UNSERVED_METHODS, method)) throw UNSERVED_METHODS[method]!();
  throw new A2aError(RPC.METHOD_NOT_FOUND, "Method not found", { metadata: { method: method.slice(0, 100) } });
}

/** This caller's task on this flow, or null: account, workspace, flow and
 *  principal all match. */
async function ownTask(ctx: Ctx, id: unknown): Promise<A2aTask | null> {
  if (typeof id !== "string" || !id || id.length > 200) return null;
  const t = await getA2aTask(ctx.target.tenant, id);
  if (!t || t.workspace !== ctx.target.workspace || t.flow !== ctx.target.flow.name || t.callerKeyId !== ctx.principal) return null;
  return t;
}

function runOf(task: A2aTask): RunRecord | null {
  if (!task.runId) return null;
  try {
    return readRun(task.tenant, task.workspace, task.runId);
  } catch {
    return null;
  }
}

/** The task as it stands, its state recorded when it moved. */
/** The task as it stands, its state recorded when it moved — and the row
 *  as it now is (`task`: with its run id when recovery just bound one). */
async function current(given: A2aTask, opts: { historyLength?: number; artifacts: "always" | "never" | "if-any"; now?: number }): Promise<{ json: TaskJson; state: A2aTaskState; task: A2aTask }> {
  // A task row without its run id may still have a run — created, then the
  // bind never landed: found by the run's own correlation and bound here.
  const task = given.runId === null ? await recoverA2aTaskRun(given).catch(() => given) : given;
  const shown = projectTask(task, runOf(task), opts);
  // A claim with no run yet is the start's to settle (bind, drop or, dead,
  // be taken over by a retry) — never marked from here, or a dead start's
  // FAILED would stop the retry that could still run it.
  const claimOnly = task.state === "admitting" && task.runId === null;
  if (!claimOnly && shown.state !== task.state) {
    await noteA2aTaskState(task.tenant, task.id, shown.state, new Date(shown.at)).catch(() => {});
    return { ...shown, task: TERMINAL_STATES.has(task.state) ? task : { ...task, state: shown.state, updatedAt: shown.at } };
  }
  return { ...shown, task };
}

/** Wait, bounded, for the task to reach an end (§3.2.2: blocking is the
 *  default), then answer it as it stands. Approval gates are WORKING and are
 *  waited through only as long as the bound. */
async function settled(task: A2aTask, historyLength: number | undefined): Promise<TaskJson> {
  const until = Date.now() + WAIT_MS();
  let shown = await current(task, { historyLength, artifacts: "if-any" });
  while (!TERMINAL_STATES.has(shown.state) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS(), Math.max(0, until - Date.now()))));
    const fresh = (await getA2aTask(task.tenant, task.id)) ?? task;
    shown = await current(fresh, { historyLength, artifacts: "if-any" });
  }
  return shown.json;
}

/** An admission refusal, as A2A sees it: a reason, never the internal
 *  sentence (it can name runs, budgets, people). Admission failure creates
 *  no task, so it is an error, not a REJECTED task. */
function notAdmitted(err: unknown): A2aError {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof AdmissionRefused && err.code === "overlap") {
    return new A2aError(RPC.SERVER_ERROR, "this agent is busy with another request — send the message again later (a new messageId is not needed)", { reason: "BUSY" });
  }
  // The owner's account already has its most runs waiting (FOL-100).
  if ((err as { code?: unknown })?.code === "waiting_cap") {
    return new A2aError(RPC.SERVER_ERROR, "this agent has too much work waiting — send the message again later (a new messageId is not needed)", { reason: "BUSY" });
  }
  if (status === 423) return new A2aError(RPC.SERVER_ERROR, "this agent is paused by its owner — try again later", { reason: "PAUSED" });
  if (status === 402) return new A2aError(RPC.SERVER_ERROR, "this agent cannot take work now — its owner's account is out of budget or funds", { reason: "UNAVAILABLE" });
  if (status === 429) return new A2aError(RPC.SERVER_ERROR, "this agent is at its limit for now — try again later", { reason: "RATE_LIMITED" });
  if (typeof status === "number" && status >= 400 && status < 500) return new A2aError(RPC.SERVER_ERROR, "this agent cannot take work now", { reason: "UNAVAILABLE" });
  reportError(err);
  return new A2aError(RPC.INTERNAL_ERROR, "Internal error");
}

async function sendMessage(ctx: Ctx, params: Record<string, unknown>): Promise<{ task: TaskJson }> {
  const { tenant, workspace, flow, pub } = ctx.target;
  const sent = readSendParams(params, pub);

  // A follow-up on a task: this agent takes one message per task.
  if (sent.taskId) {
    const t = await ownTask(ctx, sent.taskId);
    if (!t) throw taskNotFound(sent.taskId);
    if (sent.contextId && sent.contextId !== t.contextId) throw invalidParams("message.contextId does not match the task's contextId", "message.contextId");
    const shown = await current(t, { artifacts: "never" });
    throw new A2aError(
      RPC.UNSUPPORTED_OPERATION,
      TERMINAL_STATES.has(shown.state)
        ? "the task has ended and takes no more messages — send a new message without taskId (with its contextId to stay in the conversation)"
        : "this agent takes one message per task and does not take follow-up messages — wait for the task with GetTask",
    );
  }

  const fingerprint = messageFingerprint(flow.name, sent.message);

  // The claim and the open-task count, as one step per caller (Codex review,
  // 1 Nov 2026): two messages at once under maxTasks 1 used to both claim,
  // both count the other's claim, both hand theirs back and neither start.
  // Under one lock per account, workspace and key, the first claim is
  // counted by the second, and exactly one goes on. The lock is let go
  // before the run is admitted and before any wait.
  const decided = await withAdmissionLock(JSON.stringify(["a2a-claim", tenant, workspace, ctx.principal]), async (): Promise<{ answer: A2aTask } | { admit: A2aTask }> => {
    // A retry of a message already taken: the task it made, never a second.
    const claimed = await claimA2aTask({
      tenant,
      workspace,
      flow: flow.name,
      contextId: sent.contextId ?? crypto.randomUUID(),
      callerKeyId: ctx.principal,
      messageId: sent.message.messageId,
      fingerprint,
      // The message as its history shows it (projectTask fills in the ids).
      lastMessage: sent.message,
    });
    let task = claimed.task;
    if (!claimed.created) {
      if (task.fingerprint !== fingerprint) {
        throw invalidParams("message.messageId was already used for a different message — a new message needs a new messageId", "message.messageId");
      }
      // A null run id is not "no run": a start that created its run and died
      // before recording it is found by the run's correlation, and answered.
      task = await recoverA2aTaskRun(task);
      const stale = task.state === "admitting" && task.runId === null && Date.now() - Date.parse(task.updatedAt) > STALE_CLAIM_MS;
      // A start that died between claim and run is taken over by this retry,
      // once; any other existing task is simply answered.
      if (!(stale && (await retakeA2aTask(tenant, task.id, new Date(Date.now() - STALE_CLAIM_MS))))) return { answer: task };
    }

    // The outstanding cap, counted with this claim in — a new claim and a dead
    // one this retry took over alike (a dead claim reads as FAILED and stops
    // counting, so a caller could fill the slots and then revive it past the
    // cap: Codex review, 1 Nov 2026). Over it, the claim is handed back (it
    // has no run) and nothing starts.
    {
      const open = await openA2aTasks(tenant, workspace, ctx.principal);
      let live = 0;
      for (const t of open) {
        if (t.id === task.id) continue;
        if (!TERMINAL_STATES.has((await current(t, { artifacts: "never" })).state)) live++;
      }
      if (live >= ctx.caller.grant.maxTasks) {
        await dropA2aTask(tenant, task.id);
        throw new A2aError(RPC.SERVER_ERROR, `this key has ${live} tasks open, its most — wait for one to end (GetTask) or cancel one`, { reason: "TOO_MANY_TASKS", metadata: { maxTasks: String(ctx.caller.grant.maxTasks) } });
      }
    }
    return { admit: task };
  });
  if ("answer" in decided) {
    const t = decided.answer;
    return { task: sent.returnImmediately ? (await current(t, { historyLength: sent.historyLength, artifacts: "if-any" })).json : await settled(t, sent.historyLength) };
  }
  let task = decided.admit;

  // FOL-112: a published flow whose agent holds a secret and can run code
  // answers the caller with whatever that agent writes — the secret too, if
  // the caller asks. Until an admin accepts it (a2a: accept_risk) or takes
  // a leg away, no new task starts, whatever the files said when it was
  // published: read from disk now, with the library's tools, so a change
  // that never went through a write door (a library tool's secrets:) counts
  // too. Every task that admission starts passes here — a new claim and a
  // dead one this retry took over alike. Tasks already running are not
  // touched; GetTask, ListTasks and CancelTask still answer. The caller
  // hears no agent or secret name: that is for the owner (the ops log, and
  // `foldrun check`'s security/published-flow-secret-code).
  const exposed = unacceptedExposures(tenant, workspace, flow.name);
  if (exposed.length) {
    await dropA2aTask(tenant, task.id).catch(() => {});
    opsLog("warn", "a2a.exposure_refused", { tenant, workspace, flow: flow.name, agent: exposed[0]!.agent, count: exposed.length });
    throw new A2aError(RPC.SERVER_ERROR, "this agent is not taking tasks until its owner reviews what it may share — try again later", { reason: "NOT_SERVING" });
  }

  const steps = flow.steps.map((s, i) => (i === 0 ? { ...s, instruction: `${s.instruction}\n\n${requestInstruction(sent)}` } : s));
  let run: RunRecord;
  try {
    run = await admitFlowRun({
      tenant,
      workspace,
      flow,
      steps,
      startedBy: null,
      a2a: { task: task.id, key: ctx.principal },
      // FOL-162: the task's contextId (the caller's, or the one this server
      // made) is a conversation scoped to this caller's key — its first id,
      // kept across rotations — so another caller's same contextId is not it.
      conversation: { context: runContext(task.contextId, ctx.principal), input: { text: sent.text, ...(sent.hasData ? { data: sent.data } : {}) } },
    });
  } catch (err) {
    // Refused — unless a run for this task exists after all (a start that
    // raced this one): then that run is the task's, and the claim stays.
    const orphan = runOfA2aTask(tenant, workspace, task.id);
    if (!orphan) {
      await dropA2aTask(tenant, task.id).catch(() => {});
      throw notAdmitted(err);
    }
    run = orphan;
  }
  const bound = new Date();
  // Bound here, or already by a recovery that got there first: the row as
  // it stands either way — never set back to SUBMITTED over a later state.
  task = (await bindA2aTaskRun(tenant, task.id, run.id, "TASK_STATE_SUBMITTED", bound)) ?? { ...task, runId: run.id, state: "TASK_STATE_SUBMITTED", updatedAt: bound.toISOString() };
  return { task: sent.returnImmediately ? (await current(task, { historyLength: sent.historyLength, artifacts: "if-any" })).json : await settled(task, sent.historyLength) };
}

async function getTask(ctx: Ctx, params: Record<string, unknown>): Promise<TaskJson> {
  const historyLength = params.historyLength === undefined || params.historyLength === null ? undefined : Number(params.historyLength);
  if (historyLength !== undefined && (!Number.isInteger(historyLength) || historyLength < 0)) throw invalidParams("historyLength must be a whole number, 0 or more", "historyLength");
  if (typeof params.id !== "string" || !params.id) throw invalidParams("id is required", "id");
  const t = await ownTask(ctx, params.id);
  if (!t) throw taskNotFound(params.id);
  return (await current(t, { historyLength, artifacts: "if-any" })).json;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

async function listTasks(ctx: Ctx, params: Record<string, unknown>) {
  const { tenant, workspace, flow } = ctx.target;
  const pageSize = params.pageSize === undefined || params.pageSize === null ? DEFAULT_PAGE : Number(params.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE) throw invalidParams(`pageSize must be between 1 and ${MAX_PAGE} inclusive`, "pageSize");
  const historyLength = params.historyLength === undefined || params.historyLength === null ? undefined : Number(params.historyLength);
  if (historyLength !== undefined && (!Number.isInteger(historyLength) || historyLength < 0)) throw invalidParams("historyLength must be a whole number, 0 or more", "historyLength");
  const state = readStateFilter(params.status);
  const after = readPageToken(params.pageToken);
  if (params.contextId !== undefined && params.contextId !== null && typeof params.contextId !== "string") throw invalidParams("contextId must be a string", "contextId");
  const contextId = typeof params.contextId === "string" && params.contextId ? params.contextId : undefined;
  let updatedAfter: string | undefined;
  if (params.statusTimestampAfter !== undefined && params.statusTimestampAfter !== null) {
    if (typeof params.statusTimestampAfter !== "string" || Number.isNaN(Date.parse(params.statusTimestampAfter))) throw invalidParams("statusTimestampAfter must be an ISO 8601 timestamp", "statusTimestampAfter");
    updatedAfter = new Date(params.statusTimestampAfter).toISOString();
  }
  if (params.includeArtifacts !== undefined && params.includeArtifacts !== null && typeof params.includeArtifacts !== "boolean") throw invalidParams("includeArtifacts must be true or false", "includeArtifacts");
  const includeArtifacts = params.includeArtifacts === true;

  // The caller's open tasks first brought up to date, so the order and the
  // status filter read what the runs say now (the cap keeps this short).
  for (const t of await openA2aTasks(tenant, workspace, ctx.principal)) if (t.flow === flow.name) await current(t, { artifacts: "never" });

  // One clock for the filter and the projection: the status filter matches
  // the state each task SHOWS — a claim still starting shows SUBMITTED, a
  // dead one FAILED — not the row's own "admitting" (Codex review).
  const now = Date.now();
  const shownFilter = state ? { state, staleBefore: new Date(now - STALE_CLAIM_MS).toISOString() } : undefined;
  const page = await listA2aTasks({ tenant, workspace, flow: flow.name, callerKeyId: ctx.principal, contextId, shown: shownFilter, updatedAfter, after, limit: pageSize + 1 });
  const more = page.tasks.length > pageSize;
  const tasks = page.tasks.slice(0, pageSize);
  const shown = tasks.map((t) => projectTask(t, runOf(t), { historyLength, artifacts: includeArtifacts ? "always" : "never", now }).json);
  return { tasks: shown, nextPageToken: more ? pageToken(tasks[tasks.length - 1]!) : "", pageSize, totalSize: page.total };
}

async function cancelTask(ctx: Ctx, params: Record<string, unknown>): Promise<TaskJson> {
  if (typeof params.id !== "string" || !params.id) throw invalidParams("id is required", "id");
  const t = await ownTask(ctx, params.id);
  if (!t) throw taskNotFound(params.id);
  const before = await current(t, { artifacts: "if-any" });
  // Idempotent (§3.3.1): a canceled task canceled again is the same task.
  if (before.state === "TASK_STATE_CANCELED") return before.json;
  if (TERMINAL_STATES.has(before.state)) throw new A2aError(RPC.TASK_NOT_CANCELABLE, `Task cannot be canceled — it is already ${before.state.replace("TASK_STATE_", "").toLowerCase()}`);
  // The row as current() left it: a run it just recovered is the one to
  // stop — the first cancel must not answer "still starting" (Codex review).
  const runId = before.task.runId;
  if (!runId) throw new A2aError(RPC.TASK_NOT_CANCELABLE, "Task cannot be canceled yet — it is still starting; try again in a moment");
  try {
    // The trail names the caller: "cancelled by A2A caller <key label>".
    stopRun(t.tenant, t.workspace, runId, { by: a2aCallerName(ctx.caller) });
  } catch (err) {
    // Ended (409) or gone (404) between the read and the stop: the
    // projection below says which.
    const status = (err as { status?: unknown })?.status;
    if (status !== 409 && status !== 404) throw err;
  }
  const fresh = (await getA2aTask(t.tenant, t.id)) ?? t;
  const after = await current(fresh, { artifacts: "if-any" });
  if (after.state !== "TASK_STATE_CANCELED" && TERMINAL_STATES.has(after.state)) {
    throw new A2aError(RPC.TASK_NOT_CANCELABLE, `Task cannot be canceled — it is already ${after.state.replace("TASK_STATE_", "").toLowerCase()}`);
  }
  return after.json;
}

/** How a run's trail names an A2A caller: its key's label, else its prefix. */
export function a2aCallerName(c: Pick<A2aCaller, "label" | "prefix">): string {
  const name = (c.label ?? "").trim() || (c.prefix ?? "").trim() || "key";
  return `A2A caller ${name}`;
}

// ------------------------------------------------- the workspace's own view

/** GET /api/workspaces/<ws>/a2a: the flows that say `a2a:`, where each is
 *  served, and the newest A2A tasks with the key that asked — for the
 *  workspace's own people (an /api route, normal auth). */
export async function workspaceA2a(req: NextRequest, tenant: string, workspace: string) {
  const origin = publicOrigin(req);
  const flows = listFlows(tenant, workspace)
    .filter((f) => f.a2a !== undefined && f.a2a !== null)
    .map((f) => {
      const urls = a2aUrls(origin, tenant, workspace, f.name);
      const pub = f.a2a!;
      return {
        flow: f.name,
        published: pub.publish,
        publicCard: pub.publicCard,
        name: pub.name ?? f.name,
        description: pub.description ?? f.description ?? null,
        hasInputSchema: pub.input !== null,
        acceptRisk: pub.acceptRisk ?? [],
        card: urls.card,
        url: urls.endpoint,
      };
    });
  const keys = (await listApiKeys(tenant)).filter((k) => k.purpose === "a2a" && k.a2a?.workspace === workspace);
  const labelOf = (principal: string) => {
    const chain = keys.filter((k) => (k.a2a?.principal || k.id) === principal);
    const live = chain.find((k) => !k.revokedAt) ?? chain[chain.length - 1];
    return live ? { id: live.id, label: live.label, prefix: live.prefix, revoked: Boolean(live.revokedAt) } : { id: principal, label: null, prefix: null, revoked: true };
  };
  const { tasks } = await listA2aTasks({ tenant, workspace, limit: 50 });
  // FOL-112: every flow's agents that hold a secret and can run code — for
  // a flow not published yet too, so the publish control can say so before
  // the first publish. `accepted`: its a2a: accept_risk names the agent.
  const tree = workspaceA2aTree(tenant, workspace);
  const risks = [...tree.flows.entries()].flatMap(([name, f]) =>
    secretCodeExposures(tree.agentsOf(name), tree.reachOf, f.info.a2a?.acceptRisk ?? [])
      // A secret bound to sites never enters the sandbox (workspace-policy.ts sandboxSecrets).
      .map((e) => ({ flow: name, agent: e.agent, secrets: sandboxSecrets(tenant, workspace, e.secrets), accepted: e.accepted }))
      .filter((e) => e.secrets.length),
  );
  return {
    flows,
    risks,
    keys: keys.filter((k) => !k.revokedAt).map((k) => ({ id: k.id, label: k.label, prefix: k.prefix, flows: k.a2a?.flows ?? [], maxTasks: k.a2a?.maxTasks ?? null, expiresAt: k.expiresAt ?? null })),
    tasks: tasks.map((t) => {
      const shown = projectTask(t, runOf(t), { artifacts: "never", historyLength: 0 });
      return { id: t.id, flow: t.flow, state: shown.state, runId: t.runId, contextId: t.contextId, key: labelOf(t.callerKeyId), createdAt: t.createdAt, updatedAt: shown.at };
    }),
  };
}
