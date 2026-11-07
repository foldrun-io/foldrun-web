"use client";

// The "…" beside a flow's Run button: the smaller things done to a flow —
// its saved versions, its .zip, and the way to delete it (which asks on the
// Settings tab, where the danger card says what breaks).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, History, MoreHorizontal, Trash2 } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/kit/menu";
import { Button } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { HistoryDrawer } from "@/components/flow-history";
import { useCan } from "@/components/role";

export function FlowMoreMenu({ workspace, tenant, flow, file, deleteHref }: { workspace: string; tenant: string; flow: string; file: string; deleteHref: string }) {
  const [history, setHistory] = useState(false);
  const mayWrite = useCan("workspace:write");
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="icon-sm" aria-label={`More for ${flow}`}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <Tooltip label={`Every saved version of flows/${file}`} side="left">
            <MenuItem onSelect={() => setHistory(true)}>
              <History />
              Version history
            </MenuItem>
          </Tooltip>
          <Tooltip label="Download this flow and what it needs to run as a .zip" side="left">
            <MenuItem asChild>
              <a href={`/api/workspaces/${encodeURIComponent(workspace)}/export?kind=flow&name=${encodeURIComponent(flow)}`} download>
                <Download />
                Export .zip
              </a>
            </MenuItem>
          </Tooltip>
          {mayWrite && (
            <>
              <MenuSeparator />
              <MenuItem tone="danger" asChild>
                <Link href={deleteHref}>
                  <Trash2 />
                  Delete flow…
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
