"use client";

// "Why did this get worse?" (FOL-72 step 6): this run beside the flow's last
// good run — or the run it re-ran, or one you name — from
// GET …/runs/<id>/compare, the route `foldrun report --compare` reads.

import { $t } from "@/i18n";
import { useState } from "react";
import Link from "@foldrun/ui/react/link";
import type { RunComparison } from "@/lib/compare";
import { runHref } from "@/components/run-href";
import { Button } from "@foldrun/ui/react/button";
import { GitCompare, X } from "lucide-react";

export function RunCompare({ workspace, runId, tenant }: { workspace: string; runId: string; tenant: string }) {
  const [state, setState] = useState<{ comparison: RunComparison; chosen: string } | string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/compare`, { headers: { "x-foldrun-tenant": tenant } });
      const body = (await res.json().catch(() => ({}))) as { comparison?: RunComparison; chosen?: string; error?: string };
      setState(res.ok && body.comparison ? { comparison: body.comparison, chosen: body.chosen ?? "" } : body.error ?? `${res.status}`);
    } catch (err) {
      setState(String(err));
    } finally {
      setLoading(false);
    }
  };
  if (state === null) {
    return (
      <Button onClick={() => void load()} disabled={loading}>
        <GitCompare aria-hidden />
        {loading ? $t("components.run-compare.comparing") : $t("components.run-compare.compareWithTheLastGoodRun")}
      </Button>
    );
  }
  if (typeof state === "string") return <p className="text-[13px] text-fg-muted">{state}</p>;
  const c = state.comparison;
  const changed = c.steps.filter((s) => s.changes.length);
  return (
    <section className="rounded-lg border border-line bg-surface p-4 text-[13px]">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{$t("components.run-compare.comparedWith")}</span>
        <Link href={runHref(workspace, c.base.id, tenant)} className="font-mono text-fg hover:underline">{c.base.id}</Link>
        <span className="text-fg-muted">({state.chosen}, {c.base.status})</span>
        <Button size="icon-xs" variant="ghost" onClick={() => setState(null)} aria-label={$t("components.run-compare.close")} className="ml-auto">
          <X aria-hidden />
        </Button>
      </header>
      <p className="mt-2 text-fg-secondary">
        {c.revisionChanged
          ? c.changedFiles === null
            ? $t("components.run-compare.theyRanDifferentVersionsOfThe")
            : c.changedFiles.length
              ? $t("components.run-compare.filesChangedBetweenThem", { v0: String(c.changedFiles.slice(0, 8).join(", ")), v1: String(c.changedFiles.length > 8 ? $t("components.run-compare.andMore", { v0: String(c.changedFiles.length - 8) }) : "") })
              : $t("components.run-compare.theyRanDifferentRevisionsWithNo")
          : $t("components.run-compare.bothRanTheSameVersionOf")}
      </p>
      {changed.length === 0 ? (
        <p className="mt-2 text-fg-muted">{$t("components.run-compare.noStepDiffersInStatusInstruction")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {changed.map((s) => (
            <li key={`${s.step}/${s.agent}`}>
              <span className="font-medium text-fg">{$t("components.run-compare.step", { step: String(s.step), agent: s.agent })}</span>
              <ul className="ml-4 mt-0.5 list-disc text-fg-secondary">
                {s.changes.map((ch) => (
                  <li key={ch} className={/^(status|new error|tool errors)/.test(ch) ? "text-danger" : ""}>{ch}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
