// A conversation's messages with other sessions (FOL-307), on its Runs page
// while that conversation is open: what other sessions sent it and what it
// sent them, oldest first, each with where it stands. Rendered on the server
// from the functions GET …/sessions/<context>/messages (and ?sent=1) call.

import { $t } from "@/i18n";
import { Panel } from "@foldrun/ui/react/page";
import { LocalTime } from "@/components/local-time";
import { contextIdProblem } from "@/lib/conversation";
import { listSentSessionMessages, listSessionMessages, SessionMessagesUnavailable } from "@/platform/session-messages";
import { threadOf, type ThreadRow } from "@/components/session-thread";

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export async function SessionMessagesPanel({ tenant, workspace, context }: { tenant: string; workspace: string; context: string }) {
  // The id comes from the address bar: read only one the API itself would take.
  if (contextIdProblem(context)) return null;
  let messages: ThreadRow[];
  try {
    messages = threadOf(await listSessionMessages(tenant, workspace, context, { limit: 50 }), await listSentSessionMessages(tenant, workspace, context, { limit: 50 }));
  } catch (err) {
    // No platform database (a laptop install): no messages to show.
    if (err instanceof SessionMessagesUnavailable) return null;
    throw err;
  }
  if (!messages.length) return null;
  return (
    <Panel title={$t("workspace.session-messages-panel.title")} description={$t("workspace.session-messages-panel.description")} className="mb-6">
      <ol className="space-y-4">
        {messages.map((m) => {
          const other = m.direction === "out" ? m.context : (m.fromContext ?? null);
          const used = Boolean(m.run || m.usedLocally);
          const state =
            m.direction === "out"
              ? used
                ? $t("workspace.session-messages-panel.readThere")
                : $t("workspace.session-messages-panel.waitingThere")
              : used
                ? $t("workspace.session-messages-panel.taken")
                : $t("workspace.session-messages-panel.waiting");
          return (
            <li key={`${m.direction}-${m.id}`} className="border-s-2 border-border ps-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-muted">
                <span className="font-medium text-fg">
                  {m.direction === "out"
                    ? $t("workspace.session-messages-panel.sentTo", { other: other ?? "" })
                    : other
                      ? $t("workspace.session-messages-panel.from", { other, who: m.from })
                      : $t("workspace.session-messages-panel.fromPerson", { who: m.from })}
                </span>
                <LocalTime iso={m.at} options={WHEN} />
                <span>{state}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.text}</p>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
