"use client";

// The sites this agent's sandbox may reach — its `network:` line, shown as
// a run resolves it and edited in place. The edit is one PATCH to the agent
// (`{ network }`), which rewrites that one line with core's
// setNetworkSetting, so the file stays the program: the CLI's
// `foldrun agent network` writes the same line.

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
  open: "any public site",
  trusted: "package registries, source hosts and cloud SDKs, plus the sites below",
  none: "only the sites below and what the agent declares",
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
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "could not save");
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
        <h2 className="text-sm font-medium text-fg">Network</h2>
        <Chip tone={r.level === "open" ? "warn" : "good"}>{r.level}</Chip>
        <span className="text-xs text-fg-subtle">
          {r.from === "agent" ? "set on this agent" : r.from.startsWith("default") ? (r.readsWeb ? "default — it reads the web" : "default") : `from the ${r.from}`}
          {" · "}
          {LEVEL_HELP[r.level]}
        </span>
        {p.editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`ml-auto ${buttonVariants({ variant: "secondary", size: "md" })}`}>Change</button>
        )}
      </div>
      {r.level !== "open" && (
        <ul className="mt-2 space-y-1 text-xs text-fg-muted">
          {r.defaults && <li>The trusted list — {p.trustedCount} sites (npm, PyPI, GitHub, Debian, cloud SDKs, …)</li>}
          {r.added.length > 0 && (
            <li className="flex flex-wrap gap-1">Added: {r.added.map((s) => <code key={s} className="font-mono text-fg">{s}</code>)}</li>
          )}
          {r.implied.length > 0 && (
            <li className="flex flex-wrap gap-1">Declared by the agent: {r.implied.map((s) => <code key={s} className="font-mono text-fg">{s}</code>)}</li>
          )}
          <li>A run also allows its MCP servers, web providers and the sites its secrets are bound to.</li>
        </ul>
      )}
      {r.browses && p.browse === "hosted" && (
        <Callout tone="success" size="sm" className="mt-2">
          Browsing is held to this list: the browser runs inside the step&apos;s sandbox, whose network reaches only the egress proxy.{" "}
          {p.dnsWalled
            ? "It has no DNS of its own either: every name goes to the proxy, which looks up only sites on the list."
            : "Its DNS lookups are not held to the list on this install."}
        </Callout>
      )}
      {r.browses && p.browse === "vendor" && (
        <Callout tone="success" size="sm" className="mt-2">
          Browsing is held to this list through foldrun&apos;s vendor door: <code className="font-mono">{r.browseVendor}</code>&apos;s browser runs on the vendor&apos;s machines, and the session it starts has foldrun&apos;s door as its only proxy.
          A site one of its secrets is bound to is refused there (a vendor&apos;s browser cannot trust foldrun&apos;s certificate); use foldrun&apos;s own browser for those.
        </Callout>
      )}
      {r.browses && p.browse === "refuse" && (
        <Callout tone="warning" size="sm" className="mt-2">
          This agent browses with <code className="font-mono">{r.browseVendor}</code>, which browses from its own network, so this list cannot hold it: its steps are refused before they connect.
          Drop <code className="font-mono">browse: {r.browseVendor}</code> to use foldrun&apos;s own browser, which is held to the list.
        </Callout>
      )}
      {r.browses && r.level !== "open" && p.browse !== "hosted" && p.browse !== "vendor" && p.browse !== "refuse" && (
        <Callout tone="warning" size="sm" className="mt-2">
          This agent may browse, and here a browsing step is not held to this list: its browser and its other programs reach sites directly.
          Browsing is held where the platform confines it and the list is enforced; until then, to keep it inside the list, give it <code className="font-mono">web: {"{actions: [search, fetch]}"}</code>.
        </Callout>
      )}
      {p.search === "door" && (
        <Callout tone="info" size="sm" className="mt-2">
          Web search goes through the egress proxy: the account&apos;s search engine answers from a fixed set of engines
          {p.searchEngines?.length ? <> ({p.searchEngines.join(", ")})</> : null}. A query&apos;s words reach those engines, and each query is on the run&apos;s trace.
          Results are data: opening one is held to this list.
        </Callout>
      )}
      {p.search === "unnamed" && (
        <Callout tone="warning" size="sm" className="mt-2">
          Web search is not offered under this list: it is narrow on purpose ({r.level === "none" ? "network: none" : "no trusted list"}), and the agent&apos;s web: block names no actions.
          Write <code className="font-mono">web: {"{actions: [search, …]}"}</code> to let it search through the egress proxy.
        </Callout>
      )}
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={labelClass}>Level</span>
            <Select value={level} onChange={(e) => setLevel(e.target.value as NetworkLevel | "")} >
              <option value="">Inherit ({r.from === "agent" ? "workspace or default" : r.level})</option>
              <option value="trusted">trusted</option>
              <option value="open">open</option>
              <option value="none">none</option>
            </Select>
          </label>
          <label className="block">
            <span className={labelClass}>Sites to add</span>
            <Input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="api.example.com, *.example.org"
              className="w-80 font-mono" />
          </label>
          <button type="submit" disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>Cancel</button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}
