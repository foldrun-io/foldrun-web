"use client";

// Settings → API keys → Connected AI apps: the apps a person signed in to
// /api/mcp over OAuth (server/mcp-oauth.ts), with Revoke — which ends every
// token the connection issued at once.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cpu, Plug } from "lucide-react";
import { Button } from "@/components/kit/button";
import { IconBox } from "@/components/kit/page";
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

  const field = "mt-1.5 h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg";
  const machineForm = everyone ? (
    <div className="border-t border-line bg-sunken px-5 py-3 text-sm sm:px-6">
      {made && (
        <div role="status" className="mb-3 rounded-md border border-success-line bg-success-soft p-3 text-xs text-fg">
          <div className="font-medium text-success">Copy the secret now — it is not shown again.</div>
          <div className="mt-1 break-all font-mono">client_id: {made.client_id}</div>
          {made.client_secret && <div className="break-all font-mono">client_secret: {made.client_secret}</div>}
          <div className="mt-1 text-fg-muted">POST {made.token_endpoint} with grant_type=client_credentials, the id and secret as HTTP Basic; then Bearer the access token to /api/mcp.</div>
          <Button variant="ghost" className="mt-2" onClick={() => setMade(null)}>Done</Button>
        </div>
      )}
      {adding ? (
        <div className="space-y-3 py-1">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-fg">Name<input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Nightly report bot" className={field} /></label>
            <label className="block text-sm font-medium text-fg">Role<select value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} className={field}>{["viewer", "editor", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="block text-sm font-medium text-fg">Access<select value={m.access} onChange={(e) => setM({ ...m, access: e.target.value as "read" | "write" })} className={field}><option value="read">read only</option><option value="write">read and act</option></select></label>
            <label className="block text-sm font-medium text-fg sm:col-span-3">Workspaces <span className="font-normal text-fg-muted">— comma-separated; empty for all you can open</span><input value={m.workspaces} onChange={(e) => setM({ ...m, workspaces: e.target.value })} className={field} /></label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy === "add" || !m.name.trim()} onClick={() => void addMachine()}>Register</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-fg-muted">A program that signs in to /api/mcp with client credentials — no person approves each token. It acts within your role and workspaces.</p>
          <Button variant="secondary" onClick={() => setAdding(true)}>Add a machine client</Button>
        </div>
      )}
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

  return (
    <div className="mb-6 min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
      {confirmDialog}
      <div className="space-y-1.5 p-5 pb-3 sm:p-6 sm:pb-3">
        <h2 className="text-lg font-semibold text-fg">Connected AI apps</h2>
        <p className="text-sm text-fg-muted">Apps signed in to this account over OAuth. Disconnect one and every token it holds stops working.</p>
      </div>
      {connections.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-fg-muted sm:px-6">
          No AI app is connected{everyone ? " to this account" : " as you"}. claude.ai connects by itself when you add this install&apos;s /api/mcp as a custom connector.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm sm:px-6">
              <IconBox className="max-sm:hidden">{c.machine ? <Cpu /> : <Plug />}</IconBox>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">
                  {c.client} <span className="font-normal text-fg-muted">· {c.machine ? "machine client" : c.redirectHost}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  {c.access === "read" ? "read only" : "read and act"} · {c.workspaces ? c.workspaces.join(", ") : "all workspaces"}
                  {everyone ? <> · <Email value={c.person} /></> : null} · connected <LocalTime iso={c.createdAt} />
                  {c.lastUsedAt ? <> · last used <LocalTime iso={c.lastUsedAt} /></> : null}
                </p>
              </div>
              <Button variant="ghost" className="hover:text-danger" disabled={busy === c.id} onClick={() => revoke(c)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="px-5 pb-3 text-sm text-danger sm:px-6">{error}</p>}
      {machineForm}
    </div>
  );
}
