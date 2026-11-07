"use client";

// What one asset row can do besides open: open in Files, move to the shared
// library, delete. The row menu and the detail drawer's "…" menu are the same
// menu, so both use `useAssetActions` and nothing differs between them.
//
// (Until Nov 2026 a row expanded in place into a raw file editor. Opening now
// happens in the detail drawer — components/asset-drawer.tsx — and the row is
// one link.)

import Link from "@/components/kit/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/kit/confirm";
import { useCan, needs } from "@/components/role";
import { Button } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/kit/menu";
import type { AssetItem } from "@/components/asset-fields";

export function useAssetActions(item: Pick<AssetItem, "path" | "name" | "kind" | "account">, { workspace, tenant }: { workspace: string; tenant: string }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const mayWrite = useCan("workspace:write");
  const { path, name, kind, account = false } = item;
  // Account entries live in a different store; deleting routes through this
  // so the row itself doesn't care which scope it is.
  const writeUrl = account ? `/api/library/${kind}` : `/api/workspaces/${workspace}/source`;

  // What the move is doing, or why it stopped — shown beside the control
  // that started it, not only while a pointer hovers.
  const [status, setStatus] = useState<{ text: string; failed?: boolean } | null>(null);
  const moving = status !== null && !status.failed;

  // Not a hook: a hook is a folder whose run.mjs must move with it.
  // `foldrun hook add --library`.
  const canPromote = kind !== "hooks" && !account && Boolean(workspace);

  // Promote to the account scope. Without this, "this turned out to be useful
  // everywhere" means copying the file by hand and deleting the original.
  const promote = async (): Promise<boolean> => {
    if (!(await confirm({
      title: `Move ${name} to shared?`,
      body: "Every workspace in this account will be able to use it.",
      confirmLabel: "Move",
      destructive: false,
    }))) return false;
    setStatus({ text: "Moving…" });
    try {
      // One call, on the server (5 Nov 2026): a skill or folder tool moves as
      // its whole folder and nothing is deleted until everything is copied.
      const res = await fetch(`/api/workspaces/${workspace}/source/share`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status}`);
      }
      setStatus(null);
      router.refresh();
      return true;
    } catch (err) {
      setStatus({ text: err instanceof Error ? `Could not move — ${err.message}` : "Could not move", failed: true });
      return false;
    }
  };

  const remove = async (): Promise<boolean> => {
    const where = account ? " from every workspace in this account" : "";
    if (!(await confirm({ title: `Delete ${name}${where}?`, confirmLabel: "Delete" }))) return false;
    // A folder is the unit — a skill's, and a folder tool's. Sending tool.md
    // alone was refused by the store ("delete the whole folder instead").
    const target = path.replace(/\/(SKILL|tool)\.md$/, "");
    const res = await fetch(writeUrl, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: target }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus({ text: `Could not delete — ${data.error ?? res.status}`, failed: true });
      return false;
    }
    router.refresh();
    return true;
  };

  const editorHref = account
    ? `/dashboard/library/edit?kind=${kind}&path=${encodeURIComponent(path)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`
    : `/dashboard/${workspace}/edit?path=${encodeURIComponent(path)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`;

  return { confirm, confirmDialog, promote, remove, status, moving, canPromote, editorHref, mayWrite };
}

/** The "…" menu: what a row can do besides open. */
export function AssetMenuItems({
  actions,
  onDone,
}: {
  actions: ReturnType<typeof useAssetActions>;
  /** After a move or delete took the item away. */
  onDone?: () => void;
}) {
  const { promote, remove, moving, canPromote, editorHref, mayWrite } = actions;
  return (
    <>
      <MenuItem asChild>
        <Link href={editorHref}>
          <ExternalLink /> Open in Files
        </Link>
      </MenuItem>
      {canPromote && (
        <Tooltip label={mayWrite ? "Move to the shared library, usable by every workspace" : needs("workspace:write")} side="left">
          <span className="block">
            <MenuItem
              onSelect={() => void promote().then((ok) => ok && onDone?.())}
              disabled={moving || !mayWrite}
            >
              <Share2 /> Move to shared
            </MenuItem>
          </span>
        </Tooltip>
      )}
      <MenuSeparator />
      <Tooltip label={mayWrite ? undefined : needs("workspace:write")} side="left">
        <span className="block">
          <MenuItem
            tone="danger"
            disabled={!mayWrite}
            onSelect={() => void remove().then((ok) => ok && onDone?.())}
          >
            <Trash2 /> Delete
          </MenuItem>
        </span>
      </Tooltip>
    </>
  );
}

/** A row's own action: the menu, and what a move or delete is doing. */
export function AssetMenu({ item, workspace, tenant }: { item: Pick<AssetItem, "path" | "name" | "kind" | "account">; workspace: string; tenant: string }) {
  const actions = useAssetActions(item, { workspace, tenant });
  return (
    <span className="inline-flex items-center gap-2">
      {actions.confirmDialog}
      {actions.status && (
        <Tooltip label={actions.status.text}>
          <span role="status" aria-live="polite" className={`max-w-48 truncate text-xs font-medium ${actions.status.failed ? "text-danger" : "text-fg-muted"}`}>
            {actions.status.text}
          </span>
        </Tooltip>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${item.name}`}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <AssetMenuItems actions={actions} />
        </MenuContent>
      </Menu>
    </span>
  );
}
