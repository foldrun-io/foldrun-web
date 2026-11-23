"use client";

// Settings → API keys → Connected AI apps: the apps a person signed in to
// /v1/mcp over OAuth (server/mcp-oauth.ts), with Revoke — which ends every
// token the connection issued at once.

import { $el, $rich, $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cpu, Plug } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { IconBox, Field, Callout } from "@foldrun/ui/react/page";
import { LocalTime } from "@/components/local-time";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Email } from "@/components/email";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";

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
    const res = await fetch("/v1/mcp/clients", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: m.role, access: m.access, ...(workspaces ? { workspaces } : {}), name: m.name }),
    });
    const j = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; token_endpoint?: string; error?: string };
    setBusy(null);
    if (!res.ok || !j.client_id) { setError(j.error ?? $t("settings.mcp-connections.couldNotRegisterIt")); return; }
    setMade({ client_id: j.client_id, ...(j.client_secret ? { client_secret: j.client_secret } : {}), token_endpoint: j.token_endpoint ?? "" });
    setAdding(false);
    setM({ name: "", role: "viewer", access: "read", workspaces: "" });
    router.refresh();
  }

  const machineForm = everyone ? (
    <div className="border-t border-line bg-sunken px-5 py-3 text-sm sm:px-6">
      {made && (
        <Callout tone="success" className="mb-3 p-3 text-xs text-fg" role="status">
          <div className="font-medium text-success">{$t("settings.mcp-connections.copyTheSecretNowItIs")}</div>
          <div className="mt-1 break-all font-mono">{$t("settings.mcp-connections.clientId", { client_id: made.client_id })}</div>
          {made.client_secret && <div className="break-all font-mono">{$t("settings.mcp-connections.clientSecret", { client_secret: made.client_secret })}</div>}
          <div className="mt-1 text-fg-muted">{$t("settings.mcp-connections.postWithGrantTypeClientCredentials", { token_endpoint: made.token_endpoint })}</div>
          <Button variant="ghost" className="mt-2" onClick={() => setMade(null)}>{$t("settings.mcp-connections.done")}</Button>
        </Callout>
      )}
      {adding ? (
        <div className="space-y-3 py-1">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={$t("settings.mcp-connections.name")}><Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder={$t("settings.mcp-connections.nightlyReportBot")} /></Field>
            <Field label={$t("settings.mcp-connections.role")}><Select value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} className="w-full">{["viewer", "editor", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
            <Field label={$t("settings.mcp-connections.access")}><Select value={m.access} onChange={(e) => setM({ ...m, access: e.target.value as "read" | "write" })} className="w-full"><option value="read">{$t("settings.mcp-connections.readOnly")}</option><option value="write">{$t("settings.mcp-connections.readAndAct")}</option></Select></Field>
            <Field label={<>{$t("settings.mcp-connections.workspace")}{" "}<span className="font-normal text-fg-muted">{$t("settings.mcp-connections.commaSeparatedEmptyForAllYou")}</span></>} className="sm:col-span-3"><Input value={m.workspaces} onChange={(e) => setM({ ...m, workspaces: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>{$t("settings.mcp-connections.cancel")}</Button>
            <Button variant="primary" disabled={busy === "add" || !m.name.trim()} onClick={() => void addMachine()}>{$t("settings.mcp-connections.register")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-fg-muted">{$t("settings.mcp-connections.aProgramThatSignsInTo")}</p>
          <Button variant="secondary" onClick={() => setAdding(true)}>{$t("settings.mcp-connections.addAMachineClient")}</Button>
        </div>
      )}
    </div>
  ) : null;

  async function revoke(c: ConnectionRow) {
    const ok = await confirm({ title: $t("settings.mcp-connections.disconnect", { client: String(c.client) }), body: <>{$rich("settings.mcp-connections.everyTokenItHoldsStopsWorking", { email: $el(<Email value={c.person} />) })}</>, confirmLabel: $t("settings.mcp-connections.disconnect2") });
    if (!ok) return;
    setBusy(c.id);
    setError(null);
    const res = await fetch(`/v1/mcp/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? $t("settings.mcp-connections.couldNotDisconnectIt"));
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="mb-6 min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
      {confirmDialog}
      <div className="space-y-1.5 p-5 pb-3 sm:p-6 sm:pb-3">
        <h2 className="text-lg font-semibold text-fg">{$t("settings.mcp-connections.connectedAiApps")}</h2>
        <p className="text-sm text-fg-muted">{$t("settings.mcp-connections.appsSignedInToThisAccount")}</p>
      </div>
      {connections.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-fg-muted sm:px-6">
          {$t("settings.mcp-connections.noAiAppIsConnectedClaude", { part: everyone ? $t("settings.mcp-connections.toThisAccount") : $t("settings.mcp-connections.asYou") })}
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm sm:px-6">
              <IconBox className="max-sm:hidden">{c.machine ? <Cpu /> : <Plug />}</IconBox>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">
                  {c.client} <span className="font-normal text-fg-muted">· {c.machine ? $t("settings.mcp-connections.machineClient") : c.redirectHost}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  {c.access === "read" ? $t("settings.mcp-connections.readOnly") : $t("settings.mcp-connections.readAndAct")} · {c.workspaces ? c.workspaces.join(", ") : $t("settings.mcp-connections.allWorkspace")}
                  {everyone ? <> · <Email value={c.person} /></> : null}{" "}{$rich("settings.mcp-connections.connected", { localTime: $el(<LocalTime iso={c.createdAt} />) })}
                  {c.lastUsedAt ? <>{" "}{$rich("settings.mcp-connections.lastUsed", { localTime: $el(<LocalTime iso={c.lastUsedAt} />) })}</> : null}
                </p>
              </div>
              <Button variant="ghost" className="hover:text-danger" disabled={busy === c.id} onClick={() => revoke(c)}>
                {$t("settings.mcp-connections.disconnect2")}
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
