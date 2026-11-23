"use client";

// The findings, grouped by rule, each linking to the file at its line in
// the editor. "Security only" is the CLI's --security; the command line
// under the list is how to get the same answer in a terminal or CI.

import { $rich, $t, $el } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { Chip, Count, EmptyState, Stat, StatGrid, Tag, type Tone, Callout } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { Tooltip } from "@foldrun/ui/react/tooltip";

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

const LEVEL: Record<Finding["level"], { tone: Tone; label: string }> = { error: { tone: "bad", label: "error" }, warn: { tone: "warn", label: "warning" }, info: { tone: "default", label: "note" } };
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

  // The answer is set when it arrives, never in the same tick as the call,
  // so the effect below only starts the request.
  const load = useCallback(() => {
    const q = [security ? "security=1" : "", online ? "online=1" : ""].filter(Boolean).join("&");
    return fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/check${q ? `?${q}` : ""}`).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setError(null);
        setData(body);
      }
    });
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

  if (error) return <Callout tone="danger" className="px-4 py-3 text-sm">{error}</Callout>;
  if (!data) return <p className="text-sm text-fg-muted">{$t("workspace.checks-checks-panel.checking")}</p>;

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
  const toggle = (on: boolean) => cn(on && "border-line-strong bg-sunken");

  return (
    <div className="space-y-8">
      <StatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <Stat label={$t("workspace.checks-checks-panel.errors")} value={data.counts.error} tone={data.counts.error ? "danger" : undefined} sub={$t("workspace.checks-checks-panel.aDeployRefusesThese")} />
        <Stat label={$t("workspace.checks-checks-panel.warnings")} value={data.counts.warn} tone={data.counts.warn ? "warning" : undefined} sub={$t("workspace.checks-checks-panel.aDeployGoesAhead")} />
        <Stat label={$t("workspace.checks-checks-panel.notes")} value={data.counts.info} sub={$t("workspace.checks-checks-panel.worthALook")} />
      </StatGrid>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="md" className={toggle(security)} onClick={() => setSecurity((s) => !s)} aria-pressed={security}>
            {security && <Check aria-hidden />}
            {$t("workspace.checks-checks-panel.securityOnly")}
          </Button>
          {canOnline && (
            <Tooltip label={$t("workspace.checks-checks-panel.alsoAskOsvDevAboutExact")}>
              <Button
                size="md"
                className={toggle(online)}
                onClick={() => setOnline((o) => !o)}
                aria-pressed={online}
              >
                {online && <Check aria-hidden />}
                {$t("workspace.checks-checks-panel.onlineChecks")}
              </Button>
            </Tooltip>
          )}
          <Button size="md" variant="ghost" onClick={() => void again()} disabled={busy}>
            <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
            {busy ? $t("workspace.checks-checks-panel.checking") : $t("workspace.checks-checks-panel.checkAgain")}
          </Button>
        </div>
        <p className="px-1 text-[13px] text-fg-muted">
          {data.rescan ? (
            <>
              {$rich("workspace.checks-checks-panel.rescannedDailyLastNewSecurityFindings", { localTime: $el(<LocalTime iso={data.rescan.checkedAt} />) })}
            </>
          ) : (
            $t("workspace.checks-checks-panel.rescannedDailyOnceTheFirstPass")
          )}
        </p>
      </div>

      {online && (data.online?.problems.length ?? 0) > 0 && (
        <Callout tone="warning" className="px-4 py-3 text-sm" role="alert">
          <p className="font-medium">{$t("workspace.checks-checks-panel.notCheckedThisIsNotA")}</p>
          <ul className="mt-1 list-disc pl-5">
            {data.online!.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={security ? $t("workspace.checks-checks-panel.noSecurityFindings") : $t("workspace.checks-checks-panel.nothingToFix")}
          description={$t("workspace.checks-checks-panel.noCredentialWrittenIntoAFile")}
        />
      ) : (
        <section className="min-w-0 space-y-3">
          <h2 className="px-1 text-base font-medium text-fg">
            {$t("workspace.checks-checks-panel.findings")}{" "}<Count className="ml-1">{data.findings.length}</Count>
          </h2>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-sunken max-sm:hidden">
                <tr>
                  <th className="h-10 w-28 px-4 text-left text-[13px] font-medium text-fg-muted">{$t("workspace.checks-checks-panel.level")}</th>
                  <th className="h-10 px-4 text-left text-[13px] font-medium text-fg-muted">{$t("workspace.checks-checks-panel.fileAndMessage")}</th>
                </tr>
              </thead>
              {groups.map(([id, list]) => {
                const rule = ruleOf(id);
                return (
                  <tbody key={id} className="border-b border-line last:border-0">
                    <tr className="bg-sunken/60">
                      <td colSpan={2} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-[13px] font-semibold text-fg">{id}</code>
                          {rule?.title && <span className="text-sm text-fg-secondary">{rule.title}</span>}
                          {rule?.owasp?.map((o) => (
                            <Tooltip key={o} label={$t("workspace.checks-checks-panel.owaspTop10ForAgenticApplications")}>
                              <span>
                                <Tag mono>{o}</Tag>
                              </span>
                            </Tooltip>
                          ))}
                          <span className="ml-auto text-[13px] tabular-nums text-fg-muted">{list.length}</span>
                        </div>
                        {rule?.help && (
                          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg-muted">
                            <Inline text={rule.help} />
                          </p>
                        )}
                      </td>
                    </tr>
                    {list.map((f) => (
                      <tr key={`${f.fingerprint}-${f.line ?? 0}`} className="border-t border-line-faint align-top transition-colors hover:bg-sunken">
                        <td className="w-28 px-4 py-3 max-sm:pr-0">
                          <Chip tone={LEVEL[f.level].tone} dot>
                            {LEVEL[f.level].label}
                          </Chip>
                        </td>
                        <td className="min-w-0 px-4 py-3">
                          <Link href={edit(f)} className="break-all font-mono text-[13px] text-fg hover:underline">
                            {f.file}
                            {f.line ? `:${f.line}` : ""}
                          </Link>
                          <p className="mt-0.5 text-fg-muted [overflow-wrap:anywhere]">
                            <Inline text={f.message} />
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </section>
      )}

      <p className="px-1 text-[13px] text-fg-muted">
        {$t("workspace.checks-checks-panel.theSameAnswerInATerminal")}{" "}
        <code className="rounded bg-muted px-1 font-mono text-[0.92em] text-fg">
          foldrun check --to {workspace}
          {security ? " --security" : ""}
          {online ? " --online" : ""}
        </code>
        {$rich("workspace.checks-checks-panel.toAcceptAFindingPutFoldrun", { code: (chunks) => <code className="rounded bg-muted px-1 font-mono text-[0.92em] text-fg">{chunks}</code> })}
      </p>
    </div>
  );
}
