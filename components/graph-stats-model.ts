// Run counters for the graph's dots, read from run records.
//
// The graph drew structure — who steps whom, who may use what — and nothing
// about whether any of it ran. Make's canvas is loved for exactly that
// missing layer: a glance says which node is alive, which one broke last
// night, which one is quietly costing money. Three facts per agent and per
// flow, from the records, no new bookkeeping: how its last run ended, how
// many runs in the window, what they cost.
//
// Pure, so tests/graph-stats.test.ts pins the rules; server/graph.ts
// attaches the result to nodes by id.

import type { RunRecord, StepRecord } from "@/lib/store";
import type { GNode } from "@/server/graph";

export interface NodeStats {
  /** How the most recent run ended, as the runs page would show it — a
   *  stopped run says stopped, not failed. For an agent: how its steps in
   *  that run went. */
  last: string;
  /** When that run started. */
  lastAt: string;
  /** Runs inside the window. An adhoc run counts for its agent, not for
   *  any flow. */
  runs: number;
  /** Spend inside the window. A flow's is its runs' total; an agent's is
   *  its own steps' — carried steps were paid for by an earlier run and
   *  belong to it. */
  cost: number;
}

export const STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const runStatus = (r: Pick<RunRecord, "status" | "stopRequested">) =>
  r.status === "failed" && r.stopRequested ? "stopped" : r.status;

// Reading an agent's steps in one run as a single word, worst first: a
// failure is what you want to know about, then that it is still going, then
// that it waits on you. A step the stop skipped reads as stopped.
const WORST = ["failed", "running", "awaiting-approval", "stopped", "completed", "pending", "skipped"];
function agentStatus(steps: StepRecord[]): string {
  const words: string[] = steps.map((s) => (s.skipReason === "run stopped" ? "stopped" : s.status));
  for (const w of WORST) if (words.includes(w)) return w;
  return words[0] ?? "pending";
}

export function nodeStats(
  runs: (RunRecord & { workspace: string })[],
  now: number,
  windowMs: number = STATS_WINDOW_MS,
): Record<string, NodeStats> {
  const cutoff = now - windowMs;
  const out: Record<string, NodeStats & { at: number }> = {};
  for (const run of runs) {
    const at = Date.parse(run.startedAt);
    if (Number.isNaN(at)) continue;
    const inWindow = at >= cutoff;
    const touch = (id: string, status: string, cost: number) => {
      const cur = out[id] ?? (out[id] = { last: status, lastAt: run.startedAt, at, runs: 0, cost: 0 });
      if (at >= cur.at) {
        cur.last = status;
        cur.lastAt = run.startedAt;
        cur.at = at;
      }
      if (inWindow) {
        cur.runs += 1;
        cur.cost += cost;
      }
    };

    if (!run.flow.startsWith("adhoc:") && !run.flow.startsWith("eval:")) {
      touch(
        `flow:${run.workspace}:${run.flow}`,
        runStatus(run),
        run.steps.reduce((s, st) => s + (st.costUsd ?? 0), 0),
      );
    }

    const byAgent = new Map<string, StepRecord[]>();
    for (const s of run.steps) {
      if (s.carriedFrom) continue;
      byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s]);
    }
    for (const [agent, steps] of byAgent) {
      touch(
        `agent:${run.workspace}:${agent}`,
        agentStatus(steps),
        steps.reduce((s, st) => s + (st.costUsd ?? 0), 0),
      );
    }
  }
  const stats: Record<string, NodeStats> = {};
  for (const [id, s] of Object.entries(out)) stats[id] = { last: s.last, lastAt: s.lastAt, runs: s.runs, cost: s.cost };
  return stats;
}

/** Stamp the stats onto the nodes they describe. Nodes without a run keep
 *  no stats field at all, so the renderer draws nothing rather than zero. */
export function attachStats(nodes: GNode[], stats: Record<string, NodeStats>): void {
  for (const n of nodes) {
    const s = stats[n.id];
    if (s) n.stats = s;
  }
}

export function fmtAgo(ms: number): string {
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** The counter line under a dot: "12 runs · $3.21". */
export function statsLine(s: NodeStats): string {
  return `${s.runs} run${s.runs === 1 ? "" : "s"} · ${fmtCost(s.cost)}`;
}
