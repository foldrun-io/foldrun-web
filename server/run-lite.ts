// A stored run reduced to what the overview surfaces draw (mission-model's
// RunLite). Here, on the server, because the store's helpers read verdicts
// and failures and the browser must not import the store.

import { runDisplayStatus, runFailure, runVerdict, type RunRecord } from "@/lib/store";
import { runCharge, type RunCharges } from "@/server/run-charges";
import { outcomeOf } from "@/components/outcome-model";
import type { RunLite } from "@/components/mission-model";

const agentLabel = (flow: string) =>
  flow.startsWith("adhoc:") ? `agent: ${flow.slice(6)}` : flow.startsWith("eval:") ? `eval: ${flow.slice(5)}` : flow;

/** `charges`: runId → USD charged (server/run-charges.ts). Without it, or for
 *  a run not yet settled, the money is the run's list price, estimated. */
export function runLite(r: RunRecord & { workspace: string }, charges?: RunCharges): RunLite {
  const activeIdx = r.steps.findIndex((s) => s.status === "running" || s.status === "awaiting-approval");
  // A running step waiting on a question it asked (tools: [ask]) is waiting
  // for a person as surely as a parked gate — and its sandbox is live.
  const asking = r.status === "running"
    ? r.steps.map((s) => (s.status === "running" ? [...(s.questions ?? [])].reverse().find((q) => q.answer === undefined && !q.unanswered) : undefined)).find(Boolean) ?? null
    : null;
  const done = r.steps.filter((s) => s.status !== "pending" && s.status !== "running" && s.status !== "awaiting-approval").length;
  return {
    workspace: r.workspace,
    id: r.id,
    what: agentLabel(r.flow),
    outcome: asking ? "waiting" : outcomeOf(runDisplayStatus(r), r.status === "completed" ? runVerdict(r) : null),
    ...(asking ? { question: asking.question } : {}),
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    headline: r.summary?.trim() ? r.summary.trim().split("\n")[0].slice(0, 240) : null,
    failure: runFailure(r),
    steps: r.steps.length,
    done,
    active: activeIdx >= 0 ? { index: activeIdx + 1, agent: r.steps[activeIdx].agent } : null,
    // What the run is charged (FOL-54): the ledger's line, or its list price
    // until the ledger has one — not the provider's token cost.
    costUsd: runCharge(r, charges),
    revision: r.revision ?? null,
    charged: charges?.usd.has(r.id) ?? false,
  };
}
