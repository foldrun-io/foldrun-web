// A run's outcome, in one word — the thing every list, dot and cell shows.
// Status alone lies: a run that completed and reported BLOCKED is not a
// green run. So status and the agent's verdict are read together, once,
// here, and every surface draws the same answer the same way.

// The words and the counting live in core (outcome.ts), so the API, the CLI
// and the platform count exactly as the dashboard draws (FOL-54).
import type { Outcome } from "@/lib/outcome";
export { outcomeOf, tally, isLive, isCompleted, isFinished, needsAttention, needsAction, isSuccess, OUTCOMES, type Outcome, type Tally } from "@/lib/outcome";

export const OUTCOME: Record<Outcome, { label: string; dot: string; cell: string; pill: string; hint: string }> = {
  running: { label: "running", dot: "bg-sky-500 animate-pulse", cell: "bg-sky-400 animate-pulse", pill: "bg-sky-50 text-sky-700 ring-sky-200", hint: "running now" },
  queued: { label: "queued", dot: "bg-gray-400", cell: "bg-gray-300", pill: "bg-sunken text-fg-tertiary ring-line", hint: "waiting for a slot" },
  waiting: { label: "needs you", dot: "bg-violet-500 animate-pulse", cell: "bg-violet-400", pill: "bg-violet-50 text-violet-700 ring-violet-200", hint: "waiting for an approval" },
  good: { label: "good", dot: "bg-emerald-500", cell: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", hint: "completed, reported GOOD" },
  done: { label: "done", dot: "bg-emerald-300", cell: "bg-emerald-300", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", hint: "completed" },
  quiet: { label: "quiet", dot: "bg-slate-400", cell: "bg-slate-300", pill: "bg-slate-50 text-slate-600 ring-slate-200", hint: "completed, nothing to do" },
  blocked: { label: "blocked", dot: "bg-orange-500", cell: "bg-orange-400", pill: "bg-orange-50 text-orange-700 ring-orange-200", hint: "completed, reported BLOCKED" },
  bad: { label: "bad", dot: "bg-rose-500", cell: "bg-rose-400", pill: "bg-rose-50 text-rose-700 ring-rose-200", hint: "completed, reported BAD" },
  failed: { label: "failed", dot: "bg-red-600", cell: "bg-red-500", pill: "bg-red-50 text-red-700 ring-red-200", hint: "failed" },
  stopped: { label: "stopped", dot: "bg-gray-500", cell: "bg-gray-400", pill: "bg-muted text-fg-secondary ring-line-strong", hint: "stopped by a person" },
};
