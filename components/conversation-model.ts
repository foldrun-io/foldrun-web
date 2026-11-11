// The run page's line about a conversation (FOL-162): which conversation a
// run is a turn of, and what its first step was given — read off the step's
// `history` record (core conversation.ts), never the text it read.

import type { RunRecord } from "@/lib/store";

export function conversationNote(run: Pick<RunRecord, "context" | "steps">): string {
  if (!run.context) return "";
  const scope = run.context.a2a ? "An outside agent's conversation (A2A), kept apart from every other caller's" : "A conversation: runs started with the same context";
  const given = run.steps.find((s) => s.history)?.history;
  if (!given) {
    const waiting = run.steps.some((s) => s.conversationTurn && (s.status === "pending" || s.status === "running"));
    return `${scope}. ${waiting ? "Its first step reads the earlier runs when it starts." : "It was the first run in it — nothing earlier to read."}`;
  }
  const n = given.runs.length;
  return `${scope}. Its first step read ${n} earlier run${n === 1 ? "" : "s"}${given.omitted ? ` (${given.omitted} older did not fit)` : ""}${given.truncated ? `, ${given.truncated} cut short` : ""} — the runs list, filtered to it, shows them all.`;
}
