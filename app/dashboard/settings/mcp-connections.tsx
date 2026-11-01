"use client";

// Settings → API keys → Connected AI apps: the apps a person signed in to
// /api/mcp over OAuth (server/mcp-oauth.ts), with Revoke — which ends every
// token the connection issued at once.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { useConfirm } from "@/components/confirm";
import { Email } from "@/components/email";

export interface ConnectionRow {
  id: string;
  client: string;
  redirectHost: string;
  person: string;
  access: "read" | "write";
  workspaces: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function McpConnections({ connections, everyone }: { connections: ConnectionRow[]; everyone: boolean }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(c: ConnectionRow) {
    const ok = await confirm({ title: `Disconnect ${c.client}?`, body: <>Every token it holds stops working now. <Email value={c.person} /> can connect it again.</>, confirmLabel: "Disconnect" });
    if (!ok) return;
    setBusy(c.id);
    setError(null);
    const res = await fetch(`/api/mcp/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "could not disconnect it");
    setBusy(null);
    router.refresh();
  }

  if (!connections.length) {
    return <p className="text-xs text-fg-muted">No AI app is connected{everyone ? " to this account" : " as you"}. claude.ai connects by itself when you add this install&apos;s /api/mcp as a custom connector.</p>;
  }
  return (
    <div className="divide-y divide-line-faint rounded-xl border border-line bg-surface">
      {confirmDialog}
      {connections.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-fg">
              {c.client} <span className="font-normal text-fg-muted">· {c.redirectHost}</span>
            </p>
            <p className="text-xs text-fg-muted">
              {c.access === "read" ? "read only" : "read and act"} · {c.workspaces ? c.workspaces.join(", ") : "all workspaces"}
              {everyone ? <> · <Email value={c.person} /></> : null} · connected <LocalTime iso={c.createdAt} />
              {c.lastUsedAt ? <> · last used <LocalTime iso={c.lastUsedAt} /></> : null}
            </p>
          </div>
          <button type="button" disabled={busy === c.id} onClick={() => revoke(c)} className={buttonClass("secondary")}>
            Disconnect
          </button>
        </div>
      ))}
      {error && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
