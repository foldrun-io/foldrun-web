"use client";

// The sites this agent's sandbox may reach — its `network:` line, shown as
// a run resolves it and edited in place. The edit is one PATCH to the agent
// (`{ network }`), which rewrites that one line with core's
// setNetworkSetting, so the file stays the program: the CLI's
// `foldrun agent network` writes the same line.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, buttonClass, Card, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";
import type { NetworkLevel } from "@/lib/network";

export interface AgentNetworkProps {
  tenant: string;
  workspace: string;
  agent: string;
  /** What the agent's own `network:` says, read. */
  own: { level?: NetworkLevel; allow: string[]; defaults?: boolean } | null;
  /** The resolved policy, the way a run resolves it. */
  resolved: { level: NetworkLevel; from: string; added: string[]; implied: string[]; defaults: boolean; readsWeb: boolean };
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
        <Badge variant={r.level === "open" ? "warning" : "success"}>{r.level}</Badge>
        <span className="text-xs text-fg-subtle">
          {r.from === "agent" ? "set on this agent" : r.from.startsWith("default") ? (r.readsWeb ? "default — it reads the web" : "default") : `from the ${r.from}`}
          {" · "}
          {LEVEL_HELP[r.level]}
        </span>
        {p.editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`ml-auto ${buttonClass("secondary")}`}>Change</button>
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
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value as NetworkLevel | "")} className={selectClass()}>
              <option value="">Inherit ({r.from === "agent" ? "workspace or default" : r.level})</option>
              <option value="trusted">trusted</option>
              <option value="open">open</option>
              <option value="none">none</option>
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Sites to add</span>
            <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="api.example.com, *.example.org"
              className={inputClass("w-80 font-mono")} />
          </label>
          <button type="submit" disabled={busy} className={buttonClass("primary")}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className={buttonClass("minimal")}>Cancel</button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}
