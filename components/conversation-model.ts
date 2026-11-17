// The run page's line about a conversation (FOL-162): which conversation a
// run is a turn of, and what its first step was given — read off the step's
// `history` record (core conversation.ts), never the text it read.

import { $t } from "@/i18n";
import type { RunRecord } from "@/lib/store";

export function conversationNote(run: Pick<RunRecord, "context" | "steps">): string {
  if (!run.context) return "";
  const scope = run.context.a2a ? $t("components.conversation-model.anOutsideAgentS") : $t("components.conversation-model.aConversationRunsStartedWithThe");
  const given = run.steps.find((s) => s.history)?.history;
  if (!given) {
    const waiting = run.steps.some((s) => s.conversationTurn && (s.status === "pending" || s.status === "running"));
    return `${scope}. ${waiting ? $t("components.conversation-model.itsFirstStepReadsTheEarlier") : $t("components.conversation-model.itWasTheFirstRunIn")}`;
  }
  const n = given.runs.length;
  return $t("components.conversation-model.itsFirstStepReadEarlierRun", { scope: String(scope), n: String(n), v2: n, v3: String(given.omitted ? $t("components.conversation-model.olderDidNotFit", { omitted: String(given.omitted) }) : ""), v4: String(given.truncated ? $t("components.conversation-model.cutShort", { truncated: String(given.truncated) }) : "") });
}
