"use client";

// The sites this agent's sandbox may reach — its `network:` line, shown as
// a run resolves it and edited in place. The edit is one PATCH to the agent
// (`{ network }`), which rewrites that one line with core's
// setNetworkSetting, so the file stays the program: the CLI's
// `foldrun agent network` writes the same line.

import { $rich, $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, labelClass } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Chip, Card, Callout } from "@foldrun/ui/react/page";
import type { NetworkLevel } from "@/lib/network";

export interface AgentNetworkProps {
  tenant: string;
  workspace: string;
  agent: string;
  /** What the agent's own `network:` says, read. */
  own: { level?: NetworkLevel; allow: string[]; defaults?: boolean } | null;
  /** The resolved policy, the way a run resolves it. */
  resolved: { level: NetworkLevel; from: string; added: string[]; implied: string[]; defaults: boolean; readsWeb: boolean; browses?: boolean; browseVendor?: string | null };
  /** How a browsing step of this agent is held here (core browseVerdict):
   *  hosted, through the vendor door (a vendor's browser, FOL-145), refused
   *  (a vendor's browser no door holds), or legacy — not held. Null when it
   *  does not browse. */
  browse?: "hosted" | "vendor" | "refuse" | "legacy" | null;
  /** Whether a walled sandbox here has no DNS of its own either
   *  (FOLDRUN_RUN_DNS_WALL, platform run-dns.ts — FOL-128). */
  dnsWalled?: boolean;
  /** How its web search goes when a step is walled to this list (core
   *  search-egress.ts, FOL-128): through the egress proxy's search door, or
   *  not offered because the list is narrow on purpose and web: names no
   *  actions. Null when that does not apply here. */
  search?: "door" | "unnamed" | null;
  /** The engines the search door lets answer (platform search-door.ts). */
  searchEngines?: string[];
  trustedCount: number;
  editable: boolean;
}

const LEVEL_HELP: Record<NetworkLevel, string> = {
  open: $t("workspace.agents-agent-agent-network.anyPublicSite"),
  trusted: $t("workspace.agents-agent-agent-network.packageRegistriesSourceHostsAndCloud"),
  none: $t("workspace.agents-agent-agent-network.onlyTheSitesBelowAndWhat"),
};

export function AgentNetwork(p: AgentNetworkProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<NetworkLevel | "">(p.own?.level ?? "");
  const [sites, setSites] = useState((p.own?.allow ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = p.resolved;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const allow = sites.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const setting = level || allow.length || p.own?.defaults === false
        ? { ...(level ? { level } : {}), allow, ...(p.own?.defaults === false ? { defaults: false } : {}) }
        : null;
      const res = await fetch(`/api/workspaces/${encodeURIComponent(p.workspace)}/agents/${encodeURIComponent(p.agent)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-foldrun-tenant": p.tenant },
        body: JSON.stringify({ network: setting }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? $t("workspace.agents-agent-agent-network.couldNotSave"));
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-fg">{$t("workspace.agents-agent-agent-network.network")}</h2>
        <Chip tone={r.level === "open" ? "warn" : "good"}>{r.level}</Chip>
        <span className="text-xs text-fg-subtle">
          {r.from === "agent" ? $t("workspace.agents-agent-agent-network.setOnThisAgent") : r.from.startsWith("default") ? (r.readsWeb ? $t("workspace.agents-agent-agent-network.defaultItReadsTheWeb") : "default") : $t("workspace.agents-agent-agent-network.fromThe", { from: String(r.from) })}
          {" · "}
          {LEVEL_HELP[r.level]}
        </span>
        {p.editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`ml-auto ${buttonVariants({ variant: "secondary", size: "md" })}`}>{$t("workspace.agents-agent-agent-network.change")}</button>
        )}
      </div>
      {r.level !== "open" && (
        <ul className="mt-2 space-y-1 text-xs text-fg-muted">
          {r.defaults && <li>{$t("workspace.agents-agent-agent-network.theTrustedListSitesNpmPypi", { trustedCount: String(p.trustedCount) })}</li>}
          {r.added.length > 0 && (
            <li className="flex flex-wrap gap-1">{$t("workspace.agents-agent-agent-network.added")}{" "}{r.added.map((s) => <code key={s} className="font-mono text-fg">{s}</code>)}</li>
          )}
          {r.implied.length > 0 && (
            <li className="flex flex-wrap gap-1">{$t("workspace.agents-agent-agent-network.declaredByTheAgent")}{" "}{r.implied.map((s) => <code key={s} className="font-mono text-fg">{s}</code>)}</li>
          )}
          <li>{$t("workspace.agents-agent-agent-network.aRunAlsoAllowsItsMcp")}</li>
        </ul>
      )}
      {r.browses && p.browse === "hosted" && (
        <Callout tone="success" size="sm" className="mt-2">
          {$t("workspace.agents-agent-agent-network.browsingIsHeldToThisList3", { part: p.dnsWalled
            ? $t("workspace.agents-agent-agent-network.itHasNoDnsOfIts")
            : $t("workspace.agents-agent-agent-network.itsDnsLookupsAreNotHeld") })}
        </Callout>
      )}
      {r.browses && p.browse === "vendor" && (
        <Callout tone="success" size="sm" className="mt-2">
          {$rich("workspace.agents-agent-agent-network.browsingIsHeldToThisList2", { browseVendor: r.browseVendor ?? "", code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </Callout>
      )}
      {r.browses && p.browse === "refuse" && (
        <Callout tone="warning" size="sm" className="mt-2">
          {$rich("workspace.agents-agent-agent-network.thisAgentBrowsesWithWhichBrowses", { browseVendor: r.browseVendor ?? "", code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </Callout>
      )}
      {r.browses && r.level !== "open" && p.browse !== "hosted" && p.browse !== "vendor" && p.browse !== "refuse" && (
        <Callout tone="warning" size="sm" className="mt-2">
          {$rich("workspace.agents-agent-agent-network.thisAgentMayBrowseAndHere", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </Callout>
      )}
      {p.search === "door" && (
        <Callout tone="info" size="sm" className="mt-2">
          {$t("workspace.agents-agent-agent-network.webSearchGoesThroughTheEgress")}
          {p.searchEngines?.length ? <> ({p.searchEngines.join(", ")})</> : null}{$t("workspace.agents-agent-agent-network.aQuerySTraceResultsAre")}
        </Callout>
      )}
      {p.search === "unnamed" && (
        <Callout tone="warning" size="sm" className="mt-2">
          {$t("workspace.agents-agent-agent-network.webSearchIsNotOfferedUnder")}{r.level === "none" ? "network: none" : $t("workspace.agents-agent-agent-network.noTrustedList")}{$rich("workspace.agents-agent-agent-network.andTheAgentToLetIt", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </Callout>
      )}
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={labelClass}>{$t("workspace.agents-agent-agent-network.level")}</span>
            <Select value={level} onChange={(e) => setLevel(e.target.value as NetworkLevel | "")} >
              <option value="">{$t("workspace.agents-agent-agent-network.inherit")}{r.from === "agent" ? $t("workspace.agents-agent-agent-network.workspaceOrDefault") : r.level})</option>
              <option value="trusted">{$t("workspace.agents-agent-agent-network.trusted")}</option>
              <option value="open">{$t("workspace.agents-agent-agent-network.open")}</option>
              <option value="none">{$t("workspace.agents-agent-agent-network.none")}</option>
            </Select>
          </label>
          <label className="block">
            <span className={labelClass}>{$t("workspace.agents-agent-agent-network.sitesToAdd")}</span>
            <Input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="api.example.com, *.example.org"
              className="w-80 font-mono" />
          </label>
          <button type="submit" disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("workspace.agents-agent-agent-network.save")}</button>
          <button type="button" onClick={() => setEditing(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>{$t("workspace.agents-agent-agent-network.cancel")}</button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}
