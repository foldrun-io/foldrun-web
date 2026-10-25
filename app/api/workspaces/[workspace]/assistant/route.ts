// POST /api/workspaces/<ws>/assistant { messages, files?, page?, conversation? }
//
// The assistant: one reply in a conversation about building on foldrun,
// answered from foldrun's docs and this workspace's files, with any agents,
// flows, tools and skills it writes returned as proposals — checked, as
// diffs — and WRITTEN NOWHERE. The dashboard saves a proposal through the
// source PUT when a person presses Save.
//
// The reply is not computed here. This route queues it as a job for the
// worker tier (foldrun-platform/src/assistant/jobs.ts), which runs the model
// loop, writes the reply's events beside the account's files and keeps the
// conversation; this route follows those events. So a burst of questions
// lands on workers that scale with the queue, never on the pods serving
// the dashboard. With `Accept: text/event-stream` the reply streams —
// `status` (waiting, what it is reading), `text` (the words as they come),
// then `done` with the whole result and the conversation id, or `error`;
// otherwise one JSON answer. Closing the stream stops what the client sees,
// not the reply: it finishes, is charged, and is in the conversation.
//
// `conversation` continues a stored one (GET /api/assistant/conversations);
// without it a new one is started. Either way the answer names it.

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/server/api";
import { paidByPlatform, parseAssistantRequest } from "@/server/assistant";
import { enqueueAssistantJob, followJob, newJobId, ownerOf, runInline, type AssistantJob, type JobEvent } from "@/platform/assistant/jobs";
import { isConversationId } from "@/platform/assistant/conversations";
import { billing } from "@/platform/billing";
import { workspaceDir } from "@/lib/store";
import { refuseWhenLimited } from "@/server/limits";
import { idempotent } from "@/server/idempotency";
import { sseFrame } from "@/components/live-run-model";

export const dynamic = "force-dynamic";

/** Replies per person (or key) per hour — each is a model call with tools. */
const PER_HOUR = 60;
/** Replies per account per day when the platform's credential pays: those
 *  draw on the one pool every account's runs share, and an assistant must
 *  never be what stalls them. */
const PLATFORM_PER_DAY = 300;

type Ctx = { params: Promise<{ workspace: string }> };

/** The body of a finished reply, as both answers carry it. */
const doneBody = (e: Extract<JobEvent, { type: "done" }>) => ({
  ok: e.result.issues.every((i) => i.level !== "error"),
  ...e.result,
  conversation: e.conversation,
});

async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    // It reads the workspace's source and proposes writes to it: an
    // editor's job, so a viewer's key is refused before any model is called.
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    const { workspace } = await ctx.params;
    const text = await req.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json({ error: "the body is not JSON" }, { status: 400 });
    }
    const request = parseAssistantRequest(body);
    const asked = (body ?? {}) as { conversation?: unknown };
    if (asked.conversation !== undefined && asked.conversation !== null && (typeof asked.conversation !== "string" || !isConversationId(asked.conversation))) {
      return NextResponse.json({ error: "conversation is the id GET /api/assistant/conversations returned" }, { status: 400 });
    }
    if (!fs.existsSync(workspaceDir(tenant, workspace))) return NextResponse.json({ error: `no workspace "${workspace}"` }, { status: 404 });

    // The account's day first: a request it refuses must not also spend the
    // person's hour.
    const platformPays = paidByPlatform(tenant, workspace);
    const limited =
      (platformPays ? await refuseWhenLimited(`assistant-day:${tenant}`, PLATFORM_PER_DAY, 86_400) : null) ??
      (await refuseWhenLimited(`assistant:${tenant}:${actor.kind}:${actor.id}`, PER_HOUR, 3600));
    if (limited) return limited;
    // Money is checked where work is added, as a run's start checks it: an
    // empty wallet is a 402 now, not an error a worker writes later.
    if (platformPays) await billing().assertFunds(tenant);

    const job: AssistantJob = {
      id: newJobId(),
      tenant,
      workspace,
      owner: ownerOf(actor),
      conversation: typeof asked.conversation === "string" ? asked.conversation : null,
      request,
    };
    // FOLDRUN_ASSISTANT_INLINE=1: no worker tier (the tests, an install that
    // asks for it) — this process runs the reply itself. The events are the
    // same either way; only who writes them differs.
    const inline = process.env.FOLDRUN_ASSISTANT_INLINE === "1";
    const running = inline ? runInline(job) : enqueueAssistantJob(job);
    if (!inline) await running;

    if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
      if (inline) await running;
      const end = await followJob(tenant, job.id, () => undefined);
      if (end?.type === "done") return NextResponse.json(doneBody(end));
      const err = end?.type === "error" ? end : { error: "no answer", status: 500 };
      return NextResponse.json({ error: err.error }, { status: err.status });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let open = true;
        const stop = new AbortController();
        const beat = setInterval(() => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            end();
          }
        }, 15_000);
        /** Close the stream once: done, failed, or the client gone. */
        const end = () => {
          if (!open) return;
          open = false;
          clearInterval(beat);
          stop.abort();
          try {
            controller.close();
          } catch {
            // already closed or cancelled by the runtime
          }
        };
        const send = (event: string, data: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(sseFrame(event, JSON.stringify(data))));
          } catch {
            end();
          }
        };
        // The client going away stops the stream, not the reply.
        req.signal.addEventListener("abort", end, { once: true });
        followJob(
          tenant,
          job.id,
          (e) => {
            if (e.type === "queued") send("status", { text: "Waiting for a free assistant" });
            else if (e.type === "started") send("status", { text: "Thinking" });
            else if (e.type === "status" || e.type === "text") send(e.type, { text: e.text });
            else if (e.type === "done") send("done", doneBody(e));
            else if (e.type === "error") send("error", { error: e.error, status: e.status });
          },
          { signal: stop.signal },
        )
          .catch((err: unknown) => send("error", { error: err instanceof Error ? err.message : String(err), status: 500 }))
          .finally(() => {
            req.signal.removeEventListener("abort", end);
            end();
          });
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. A streamed
 *  reply is never replayed; it answers afresh. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
