"use client";

// The findings, grouped by rule, each linking to the file at its line in
// the editor. "Security only" is the CLI's --security; the command line
// under the list is how to get the same answer in a terminal or CI.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, EmptyScreen, StatCard, chipButtonClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

interface Finding {
  rule: string;
  level: "error" | "warn" | "info";
  file: string;
  line?: number;
  message: string;
  fingerprint: string;
}

interface Rule {
  id: string;
  category: string;
  title: string;
  help: string;
  owasp?: string[];
}

interface Answer {
  counts: { error: number; warn: number; info: number };
  findings: Finding[];
  rules: Rule[];
  /** With ?online=1 (FOL-58): what the network checks could not check. */
  online?: { problems: string[] };
  /** The daily rescan's last pass, or null before the first. */
  rescan?: { checkedAt: string; findings: number; pending: number; problems: string[] } | null;
}

const VARIANT = { error: "error", warn: "warning", info: "default" } as const;
const RANK = { error: 0, warn: 1, info: 2 };
/** Within a level, what can leak or be turned comes before a typo. */
const CATEGORY_ORDER = ["secret", "security", "content", "supply-chain", "config"];

/** Rule help and messages quote fields and commands in backticks, as the
 *  CLI prints them; here they read as code. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.92em] text-fg">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ChecksPanel({ workspace, tenantQuery, canOnline = true }: { workspace: string; tenantQuery: string; canOnline?: boolean }) {
  const [security, setSecurity] = useState(false);
  const [online, setOnline] = useState(false);
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = [security ? "security=1" : "", online ? "online=1" : ""].filter(Boolean).join("&");
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/check${q ? `?${q}` : ""}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
    else {
      setError(null);
      setData(body);
    }
  }, [workspace, security, online]);

  useEffect(() => {
    void load();
  }, [load]);

  const again = async () => {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-fg-subtle">Checking…</p>;

  const byRule = new Map<string, Finding[]>();
  for (const f of data.findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  const ruleOf = (id: string) => data.rules.find((r) => r.id === id);
  const order = (id: string) => {
    const at = CATEGORY_ORDER.indexOf(ruleOf(id)?.category ?? "config");
    return at === -1 ? CATEGORY_ORDER.length : at;
  };
  const groups = [...byRule.entries()].sort(
    ([a, fa], [b, fb]) =>
      Math.min(...fa.map((f) => RANK[f.level])) - Math.min(...fb.map((f) => RANK[f.level])) || order(a) - order(b) || a.localeCompare(b),
  );
  const edit = (f: Finding) => `/dashboard/${encodeURIComponent(workspace)}/edit?path=${encodeURIComponent(f.file)}${tenantQuery}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chipButtonClass(security ? "border-ink text-fg" : "")} onClick={() => setSecurity((s) => !s)} aria-pressed={security}>
          {security ? "✓ " : ""}Security only
        </button>
        {canOnline && (
          <button
            type="button"
            className={chipButtonClass(online ? "border-ink text-fg" : "")}
            onClick={() => setOnline((o) => !o)}
            aria-pressed={online}
            title="Also ask OSV.dev about exact runtime pins, and read what remote MCP servers tell the model about their tools"
          >
            {online ? "✓ " : ""}Online checks
          </button>
        )}
        <button type="button" className={chipButtonClass()} onClick={() => void again()} disabled={busy}>
          {busy ? "Checking…" : "Check again"}
        </button>
        <span className="text-xs text-fg-subtle">
          {data.rescan ? (
            <>
              Rescanned daily, last <LocalTime iso={data.rescan.checkedAt} /> — new security findings are sent to notify:.
            </>
          ) : (
            "Rescanned daily once the first pass has run — new security findings are sent to notify:."
          )}
        </span>
      </div>
      {online && (data.online?.problems.length ?? 0) > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">Not checked — this is not a pass:</p>
          <ul className="mt-1 list-disc pl-4">
            {data.online!.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Errors — a deploy refuses these" value={String(data.counts.error)} tone={data.counts.error ? "error" : undefined} />
        <StatCard label="Warnings" value={String(data.counts.warn)} />
        <StatCard label="Notes" value={String(data.counts.info)} />
      </div>

      {groups.length === 0 ? (
        <EmptyScreen
          title={security ? "No security findings" : "Nothing to fix"}
          description="No credential written into a file, no hidden text, no agent that reads the web while holding a secret and an open way out, and nothing a deploy would refuse."
        />
      ) : (
        groups.map(([id, list]) => {
          const rule = ruleOf(id);
          return (
            <Card key={id} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <code className="text-sm font-semibold text-fg">{id}</code>
                <span className="text-sm text-fg-muted">{rule?.title}</span>
                {rule?.owasp?.map((o) => (
                  <Badge key={o} title="OWASP Top 10 for Agentic Applications (2026)">{o}</Badge>
                ))}
                <span className="ml-auto text-xs text-fg-subtle">{list.length}</span>
              </div>
              {rule?.help && (
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  <Inline text={rule.help} />
                </p>
              )}
              <ul className="mt-3 divide-y divide-line">
                {list.map((f) => (
                  <li key={`${f.fingerprint}-${f.line ?? 0}`} className="flex items-start gap-3 py-2 text-sm">
                    <Badge variant={VARIANT[f.level]}>{f.level}</Badge>
                    <div className="min-w-0 flex-1">
                      <Link href={edit(f)} className="font-mono text-xs text-fg hover:underline">
                        {f.file}
                        {f.line ? `:${f.line}` : ""}
                      </Link>
                      <p className="text-fg-muted">
                        <Inline text={f.message} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}

      <p className="text-xs text-fg-subtle">
        The same answer in a terminal: <code>foldrun check --to {workspace}{security ? " --security" : ""}{online ? " --online" : ""}</code>. To accept a finding, put{" "}
        <code>{"<!-- foldrun-ignore <rule>: <reason> -->"}</code> on the line before it.
      </p>
    </div>
  );
}
