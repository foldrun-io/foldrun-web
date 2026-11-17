"use client";

// The "…" beside a flow's Run button: the smaller things done to a flow —
// its saved versions, its .zip, and the way to delete it (which asks on the
// Settings tab, where the danger card says what breaks).

import { $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useEffect, useState } from "react";
import { Download, History, MoreHorizontal, Trash2 } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@foldrun/ui/react/menu";
import { Button } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { HistoryDrawer } from "@/components/flow-history";
import { useCan } from "@/components/role";

export function FlowMoreMenu({ workspace, tenant, flow, file, deleteHref }: { workspace: string; tenant: string; flow: string; file: string; deleteHref: string }) {
  const [history, setHistory] = useState(false);
  const mayWrite = useCan("workspace:write");
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="icon-sm" aria-label={$t("workspace.flows-flow-actions.moreFor", { flow: String(flow) })}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <Tooltip label={$t("workspace.flows-flow-actions.everySavedVersionOfFlows", { file: String(file) })} side="left">
            <MenuItem onSelect={() => setHistory(true)}>
              <History />
              {$t("workspace.flows-flow-actions.versionHistory")}
            </MenuItem>
          </Tooltip>
          <Tooltip label={$t("workspace.flows-flow-actions.downloadThisFlowAndWhatIt")} side="left">
            <MenuItem asChild>
              <a href={`/api/workspaces/${encodeURIComponent(workspace)}/export?kind=flow&name=${encodeURIComponent(flow)}`} download>
                <Download />
                {$t("workspace.flows-flow-actions.exportZip")}
              </a>
            </MenuItem>
          </Tooltip>
          {mayWrite && (
            <>
              <MenuSeparator />
              <MenuItem tone="danger" asChild>
                <Link href={deleteHref}>
                  <Trash2 />
                  {$t("workspace.flows-flow-actions.deleteFlow")}
                </Link>
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      {history && <HistoryDrawer workspace={workspace} tenant={tenant} flow={flow} file={file} onClose={() => setHistory(false)} />}
    </>
  );
}

/** Old links named a flow by its card's anchor (`/flows#flow-digest`); the
 *  list has no cards now, so such a link opens that flow's own page. */
export function FlowHashRedirect({ flows, query }: { flows: { name: string; anchor: string }[]; query: string }) {
  useEffect(() => {
    let hash = window.location.hash.replace(/^#/, "");
    try {
      hash = decodeURIComponent(hash);
    } catch {
      /* a hash that is not encoding stays as written */
    }
    const hit = hash ? flows.find((f) => f.anchor === hash) : undefined;
    if (hit) window.location.replace(`${window.location.pathname}?flow=${encodeURIComponent(hit.name)}${query}`);
  }, [flows, query]);
  return null;
}
