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
  /** A machine client (client credentials), registered by an admin. */
  machine?: boolean;
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
  // Add a machine client (client credentials): admins only.
  const [adding, setAdding] = useState(false);
  const [m, setM] = useState<{ name: string; role: string; access: "read" | "write"; workspaces: string }>({ name: "", role: "viewer", access: "read", workspaces: "" });
  const [made, setMade] = useState<{ client_id: string; client_secret?: string; token_endpoint: string } | null>(null);

  async function addMachine() {
    setError(null);
    setBusy("add");
    // Empty means "the ones you can open": left out, so a scoped admin's own
    // scope is used (null would ask for every workspace, which they cannot give).
    const workspaces = m.workspaces.trim() ? m.workspaces.split(",").map((w) => w.trim()).filter(Boolean) : undefined;
    const res = await fetch("/api/mcp/clients", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: m.role, access: m.access, ...(workspaces ? { workspaces } : {}), name: m.name }),
    });
    const j = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; token_endpoint?: string; error?: string };
    setBusy(null);
    if (!res.ok || !j.client_id) { setError(j.error ?? "could not register it"); return; }
    setMade({ client_id: j.client_id, ...(j.client_secret ? { client_secret: j.client_secret } : {}), token_endpoint: j.token_endpoint ?? "" });
    setAdding(false);
    setM({ name: "", role: "viewer", access: "read", workspaces: "" });
    router.refresh();
  }

  const machineForm = everyone ? (
    <div className="mt-3 text-sm">
      {made && (
        <div className="mb-3 rounded border border-line p-3 text-xs">
          <div className="font-medium">Copy the secret now — it is not shown again.</div>
          <div className="mt-1 font-mono break-all">client_id: {made.client_id}</div>
          {made.client_secret && <div className="font-mono break-all">client_secret: {made.client_secret}</div>}
          <div className="mt-1 text-fg-muted">POST {made.token_endpoint} with grant_type=client_credentials, the id and secret as HTTP Basic; then Bearer the access token to /api/mcp.</div>
          <button type="button" onClick={() => setMade(null)} className={`${buttonClass("minimal")} mt-2`}>Done</button>
        </div>
      )}
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
          <label className="text-xs">Name<input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Nightly report bot" className="mt-1 block rounded border border-line bg-surface px-2 py-1" /></label>
          <label className="text-xs">Role<select value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} className="mt-1 block rounded border border-line bg-surface px-2 py-1">{["viewer", "editor", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label className="text-xs">Access<select value={m.access} onChange={(e) => setM({ ...m, access: e.target.value as "read" | "write" })} className="mt-1 block rounded border border-line bg-surface px-2 py-1"><option value="read">read only</option><option value="write">read and act</option></select></label>
          <label className="text-xs">Workspaces (comma-separated; empty for all you can open)<input value={m.workspaces} onChange={(e) => setM({ ...m, workspaces: e.target.value })} className="mt-1 block rounded border border-line bg-surface px-2 py-1" /></label>
          <button type="button" disabled={busy === "add" || !m.name.trim()} onClick={() => void addMachine()} className={buttonClass("primary")}>Register</button>
          <button type="button" onClick={() => setAdding(false)} className={buttonClass("minimal")}>Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={buttonClass("secondary")}>Add a machine client</button>
      )}
      <p className="mt-1 text-xs text-fg-muted">A program that signs in to /api/mcp with client credentials — no person approves each token. It acts within your role and workspaces, and stops if you lose them.</p>
    </div>
  ) : null;

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
    return (
      <div>
        <p className="text-xs text-fg-muted">No AI app is connected{everyone ? " to this account" : " as you"}. claude.ai connects by itself when you add this install&apos;s /api/mcp as a custom connector.</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {machineForm}
      </div>
    );
  }
  return (
    <div className="divide-y divide-line-faint rounded-xl border border-line bg-surface">
      {confirmDialog}
      {connections.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-fg">
              {c.client} <span className="font-normal text-fg-muted">· {c.machine ? "machine client" : c.redirectHost}</span>
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
      <div className="px-4 pb-3">{machineForm}</div>
    </div>
  );
}
