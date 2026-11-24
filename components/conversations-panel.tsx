// A project's conversations (FOL-236), on its Runs page: the most recently
// used first, each opening the runs page filtered to its turns. Rendered on
// the server from the function GET /v1/workspaces/<ws>/sessions calls.

import { $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { Panel } from "@foldrun/ui/react/page";
import { Table, THead, TBody, TR, TH, TD } from "@foldrun/ui/react/table";
import { LocalTime } from "@/components/local-time";
import { RUN_STATUS_LABEL, labelOf } from "@/components/value-labels";
import type { SessionSummary } from "@/lib/conversation";

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export function ConversationsPanel({ sessions, workspace, tenantParam }: { sessions: SessionSummary[]; workspace: string; tenantParam: string }) {
  if (!sessions.length) return null;
  return (
    <Panel title={$t("workspace.conversations-panel.title")} description={$t("workspace.conversations-panel.description")} flush className="mb-6">
      <Table className="min-w-[640px]">
        <THead>
          <tr>
            <TH>{$t("workspace.conversations-panel.conversation")}</TH>
            <TH>{$t("workspace.conversations-panel.turns")}</TH>
            <TH>{$t("workspace.conversations-panel.agent")}</TH>
            <TH>{$t("workspace.conversations-panel.last")}</TH>
            <TH>{$t("workspace.conversations-panel.status")}</TH>
          </tr>
        </THead>
        <TBody>
          {sessions.map((x) => (
            <TR key={x.context}>
              <TD className="font-mono text-xs">
                <Link href={`/dashboard/${workspace}/runs?context=${encodeURIComponent(x.context)}${tenantParam}`} className="hover:underline">
                  {x.context}
                </Link>
              </TD>
              <TD className="tabular-nums">{x.turns}</TD>
              <TD>{x.agent ?? "—"}</TD>
              <TD className="whitespace-nowrap tabular-nums text-fg-muted">
                <LocalTime iso={x.lastAt} options={WHEN} />
              </TD>
              <TD>{labelOf(RUN_STATUS_LABEL, x.lastStatus)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
