"use client";

// "Why did this get worse?" (FOL-72 step 6): this run beside the flow's last
// good run — or the run it re-ran, or one you name — from
// GET …/runs/<id>/compare, the route `foldrun report --compare` reads.

import { useState } from "react";
import Link from "next/link";
import type { RunComparison } from "@/lib/compare";
import { runHref } from "@/components/run-href";

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
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-line hover:bg-sunken hover:text-fg disabled:opacity-50">
        {loading ? "comparing…" : "compare with the last good run"}
      </button>
    );
  }
  if (typeof state === "string") return <p className="text-xs text-fg-muted">{state}</p>;
  const c = state.comparison;
  const changed = c.steps.filter((s) => s.changes.length);
  return (
    <section className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <header className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-medium uppercase tracking-wide text-fg-subtle">compared with</span>
        <Link href={runHref(workspace, c.base.id, tenant)} className="font-mono text-fg hover:underline">{c.base.id}</Link>
        <span className="text-fg-subtle">({state.chosen}, {c.base.status})</span>
        <button type="button" onClick={() => setState(null)} className="ml-auto text-fg-muted hover:text-fg">close</button>
      </header>
      <p className="mt-1.5 text-xs text-fg-secondary">
        {c.revisionChanged
          ? c.changedFiles === null
            ? "They ran different versions of the files (the history does not say which files)."
            : c.changedFiles.length
              ? `Files changed between them: ${c.changedFiles.slice(0, 8).join(", ")}${c.changedFiles.length > 8 ? ` and ${c.changedFiles.length - 8} more` : ""}.`
              : "They ran different revisions with no file changes between them."
          : "Both ran the same version of the files."}
      </p>
      {changed.length === 0 ? (
        <p className="mt-1.5 text-xs text-fg-muted">No step differs in status, instruction, model, tools, errors, time or tokens.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {changed.map((s) => (
            <li key={`${s.step}/${s.agent}`} className="text-xs">
              <span className="font-medium text-fg">step {s.step} · {s.agent}</span>
              <ul className="ml-4 mt-0.5 list-disc text-fg-tertiary">
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
