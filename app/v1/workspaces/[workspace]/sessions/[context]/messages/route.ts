// Session messages (19 Nov 2026): send one conversation of this project a
// message, or read what it was sent. A message waits until the person in
// that conversation includes it in a turn (POST …/agents/<agent>/run with
// `messages`); it is never put into a running step — that is
// POST …/runs/<id>/message. platform/session-messages.ts says why.
//
// Sending needs `run:start` in the project: the same right that already
// lets a caller join the conversation by its id. Reading needs a member.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, requireTenant, refuse } from "@/server/api";
import { requireWorkspace } from "@/lib/storage";
import { workspaceDir } from "@/lib/store";
import fs from "node:fs";
import { jsonObject } from "@/server/body";
import { idempotent } from "@/server/idempotency";
import { contextIdProblem } from "@/lib/conversation";
import {
  listSentSessionMessages,
  listSessionThread,
  listSessionMessages,
  messageTextProblem,
  sendSessionMessage,
  SessionMessagesUnavailable,
  TooManyWaiting,
} from "@/platform/session-messages";

type Ctx = { params: Promise<{ workspace: string; context: string }> };

function known(err: unknown): NextResponse | null {
  if (err instanceof SessionMessagesUnavailable) return refuse(err.message, 503);
  if (err instanceof TooManyWaiting) return refuse(err.message, 409);
  return null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace, context } = await ctx.params;
    const tenant = await requireTenant(req);
    requireWorkspace(tenant, workspace);
    const problem = contextIdProblem(context);
    if (problem) return refuse(problem, 400);
    const waiting = req.nextUrl.searchParams.get("waiting");
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
    // The thread with another conversation, both ways (FOL-307).
    const other = req.nextUrl.searchParams.get("with");
    if (other !== null) {
      const otherProblem = contextIdProblem(other);
      if (otherProblem) return refuse(`with: ${otherProblem}`, 400);
      if (other === context) return refuse("with: name another conversation, not this one", 400);
      return NextResponse.json({ context, with: other, messages: await listSessionThread(tenant, workspace, context, other, { limit }) });
    }
    const sent = req.nextUrl.searchParams.get("sent");
    if (sent === "1" || sent === "true") return NextResponse.json({ context, sent: true, messages: await listSentSessionMessages(tenant, workspace, context, { limit }) });
    const messages = await listSessionMessages(tenant, workspace, context, { waiting: waiting === "1" || waiting === "true", limit });
    return NextResponse.json({ context, messages });
  } catch (err) {
    return known(err) ?? errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace, context } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    requireWorkspace(tenant, workspace);
    const problem = contextIdProblem(context);
    if (problem) return refuse(problem, 400);
    const body = (await jsonObject(req, { optional: true })) as { text?: unknown; from?: unknown };
    const textProblem = messageTextProblem(body.text);
    if (textProblem) return refuse(textProblem, 400);
    let fromContext: string | undefined;
    if (body.from !== undefined && body.from !== null) {
      const fromProblem = contextIdProblem(body.from);
      if (fromProblem) return refuse(`from: ${fromProblem}`, 400);
      fromContext = body.from as string;
    }
    const message = await sendSessionMessage({
      tenant,
      workspace,
      context,
      sender: `${actor.kind}:${actor.id}`,
      senderName: actor.name,
      fromContext,
      text: (body.text as string).trim(),
      stillThere: () => fs.existsSync(workspaceDir(tenant, workspace)),
    });
    return NextResponse.json({ ok: true, message }, { status: 201 });
  } catch (err) {
    return known(err) ?? errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
