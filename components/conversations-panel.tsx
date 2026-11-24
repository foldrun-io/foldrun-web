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
import { ConversationRename } from "@/components/conversation-rename";

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export function ConversationsPanel({ sessions, workspace, tenant, tenantParam }: { sessions: SessionSummary[]; workspace: string; tenant: string; tenantParam: string }) {
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
            <TH>
              <span className="sr-only">{$t("workspace.conversations-panel.actions")}</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {sessions.map((x) => (
            <TR key={x.context}>
              <TD>
                <Link href={`/dashboard/${workspace}/runs?context=${encodeURIComponent(x.context)}${tenantParam}`} className="hover:underline">
                  {x.name ?? <span className="font-mono text-xs">{x.context}</span>}
                </Link>
                {x.name && <div className="font-mono text-xs text-fg-muted">{x.context}</div>}
              </TD>
              <TD className="tabular-nums">{x.turnsMore ? $t("workspace.conversations-panel.turnsAtLeast", { n: x.turns }) : x.turns}</TD>
              <TD>{x.agent ?? "—"}</TD>
              <TD className="whitespace-nowrap tabular-nums text-fg-muted">
                <LocalTime iso={x.lastAt} options={WHEN} />
              </TD>
              <TD>{labelOf(RUN_STATUS_LABEL, x.lastStatus)}</TD>
              <TD className="text-right">
                <ConversationRename workspace={workspace} tenant={tenant} context={x.context} name={x.name} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
