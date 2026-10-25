// Gates and questions waiting on a person, across the workspaces a caller
// may see — what GET /api/approvals answers and what the inbox lists. One
// function each, so the banner, the approvals list and the inbox never
// disagree about what is waiting (see app/api/approvals/route.ts for why the
// unit is the waiting step, not the run).

import { listAllRunSummaries } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { openQuestions } from "@/platform/operator-store";

export interface PendingGate {
  workspace: string;
  runId: string;
  flow: string;
  /** Index into the run's steps — what the approve route takes as `step`. */
  step: number;
  agent: string;
  /** The `ask:` text, when the flow wrote one; else the step's instruction. */
  question: string;
  /** Whether the flow wrote an `ask:` (a real question) or just `!`. */
  asked: boolean;
  startedAt: string;
  /** When this gate started waiting — the last event's time, which is the
   *  "waiting for an answer" line the runner writes when it parks. */
  waitingSince: string;
}

/** A question an agent asked mid-step (tools: [ask]) — its sandbox is live
 *  and waiting. Answered with POST …/runs/<id>/answer {question: id}. */
export interface PendingQuestion {
  kind: "question";
  id: string;
  workspace: string;
  runId: string;
  flow: string;
  agent: string;
  /** The asking step's index in run.steps, when its lease said. */
  step?: number;
  question: string;
  options?: string[];
  askedAt: string;
}

/** Every gate and question waiting on a person in the workspaces `scope` allows. */
export async function pendingForPeople(tenant: string, scope: string[] | null): Promise<{ approvals: PendingGate[]; questions: PendingQuestion[] }> {
  const actor = { workspaces: scope };
    const approvals: PendingGate[] = [];
    for (const r of listAllRunSummaries(tenant)) {
      if (!r.awaitingApproval) continue;
      if (!scopeAllows(actor.workspaces, r.workspace)) continue;
      r.steps.forEach((s, i) => {
        if (s.status !== "awaiting-approval") return;
        // wait: event steps park with the same status but wait on a webhook,
        // not a person; a banner asking someone to approve them would be
        // asking for a thing no button can do.
        if (s.waitFor === "event") return;
        approvals.push({
          workspace: r.workspace,
          runId: r.id,
          flow: r.flow,
          step: i,
          agent: s.agent,
          question: (s.ask ?? "").trim() || s.instruction || "",
          asked: Boolean(s.ask?.trim()),
          startedAt: r.startedAt,
          waitingSince: s.waitingSince ?? r.startedAt,
        });
      });
    }
    approvals.sort((a, b) => (a.waitingSince < b.waitingSince ? -1 : 1));
    // Questions asked mid-step, for steps still running — a question left
    // open by a step that ended has nobody waiting for its answer, and one
    // closed (its ask timed out) never comes back from openQuestions.
    const runs = new Map(listAllRunSummaries(tenant).map((r) => [r.id, r]));
    const questions: PendingQuestion[] = [];
    for (const q of await openQuestions(tenant)) {
      const r = runs.get(q.runId);
      if (!r || r.status !== "running" || !scopeAllows(actor.workspaces, r.workspace)) continue;
      const named = typeof q.step === "number" ? r.steps[q.step] : undefined;
      if (typeof q.step === "number" && named?.status !== "running") continue;
      const step = named ?? r.steps.find((s) => s.status === "running");
      if (!step) continue;
      questions.push({
        kind: "question",
        id: q.id,
        workspace: r.workspace,
        runId: r.id,
        flow: r.flow,
        agent: step.agent,
        ...(typeof q.step === "number" ? { step: q.step } : {}),
        question: q.question,
        ...(q.options?.length ? { options: q.options } : {}),
        askedAt: q.askedAt,
      });
    }
  return { approvals, questions };
}
