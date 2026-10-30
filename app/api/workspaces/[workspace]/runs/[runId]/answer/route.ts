// Answer a question an agent asked mid-step (tools: [ask], ask_person). The
// agent is waiting in a live sandbox; the answer reaches it over the egress
// proxy on its next poll, and its trace records who answered and what.
// First answer wins: a second one is refused with the answer that stands.
// A question nobody is waiting on any more — closed when the ask timed out,
// marked unanswered on the record, or its step no longer running — is
// refused (409): an answer there would reach no one.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, errorResponse, requirePermission, refuse } from "@/server/api";
import { readRun } from "@/lib/store";
import { ANSWER_MAX, answerQuestion, getQuestion } from "@/platform/operator-store";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string }> }) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const body = (await req.json().catch(() => ({}))) as { question?: unknown; answer?: unknown };
    const id = typeof body.question === "string" ? body.question : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!id || !answer) return refuse("expected { question: <id>, answer }", 400);
    if (answer.length > ANSWER_MAX) return refuse(`an answer is at most ${ANSWER_MAX} characters`, 413);
    const run = readRun(tenant, workspace, runId);
    if (!run) return refuse("run not found", 404);
    const q = await getQuestion(tenant, runId, id);
    if (!q) return refuse("no such question on this run — it may have expired", 404);
    if (q.answer === undefined) {
      const gone = (why: string) => refuse(`the agent is no longer waiting on this question — ${why}`, 409);
      if (q.closed) return gone("it stopped waiting (closed)");
      // The asking step: the one the lease named, else the one whose record
      // carries the question, else (not traced yet) any running step.
      const idx = typeof q.step === "number" ? q.step : run.steps.findIndex((s) => s.questions?.some((x) => x.id === id));
      const s = idx >= 0 ? run.steps[idx] : undefined;
      if (s?.questions?.find((x) => x.id === id)?.unanswered) return gone("it was marked unanswered");
      if (run.status !== "running") return gone(`the run is ${run.status}`);
      if (s ? s.status !== "running" : !run.steps.some((x) => x.status === "running")) {
        return gone(s ? `its step is ${s.status}` : "no step is running");
      }
    }
    const by = await actorOf(req);
    const res = await answerQuestion(tenant, runId, id, answer, by);
    if (!res) return refuse("no such question on this run — it may have expired", 404);
    if (res.closed) return refuse("the agent is no longer waiting on this question — it stopped waiting (closed)", 409);
    if (res.already) {
      return NextResponse.json(
        { error: "already answered", answer: res.question.answer, by: res.question.by ?? null, answeredAt: res.question.answeredAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, question: id, answer: res.question.answer, by });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
