"use client";

// What rolling back to a revision would change, before anyone confirms it.
//
// POST /deploy's dryRun wants every file of the tree in the body — which
// the browser does not have for an old revision. Putting an old revision's
// snapshot live is exactly what a restore does (server/restore.ts: same
// deployWorkspace, same kept-on-deploy rule), so the preview is
// POST /restore { to, dryRun }:
// each file it would change, bring back or remove, with the diff, and the
// runs in flight that would refuse it, and what the deploy checks say of
// that tree: `issues` refuse it, `warnings` do not.

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";

type DiffOp = { kind: "same" | "add" | "del"; text: string };

export interface DeployPreviewPlan {
  to: { sha: string; at: string; by: string; message: string };
  from: string | null;
  added: string[];
  updated: string[];
  removed: string[];
  files: { path: string; change: "added" | "updated" | "removed"; diff: DiffOp[] }[];
  blockedBy: string[];
  noop: boolean;
  issues?: { where?: string; message: string }[];
  warnings?: { where?: string; message: string }[];
}

function Diff({ ops }: { ops: DiffOp[] }) {
  // Changed lines with two lines of context; long runs of sameness folded.
  const keep = ops.map((o, i) => o.kind !== "same" || ops.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same"));
  const out: React.ReactNode[] = [];
  let folded = 0;
  ops.forEach((o, i) => {
    if (!keep[i]) {
      folded++;
      return;
    }
    if (folded) {
      out.push(<div key={`f${i}`} className="text-fg-subtle">⋯ {folded} unchanged</div>);
      folded = 0;
    }
    out.push(
      <div key={i} className={o.kind === "add" ? "bg-success-soft text-success" : o.kind === "del" ? "bg-danger-soft text-danger" : "text-fg-muted"}>
        {o.kind === "add" ? "+ " : o.kind === "del" ? "- " : "  "}
        {o.text}
      </div>,
    );
  });
  if (folded) out.push(<div key="tail" className="text-fg-subtle">⋯ {folded} unchanged</div>);
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line-faint p-2 font-mono text-[11px] leading-4">{out}</pre>;
}

/** Fetches the plan for `to` (a sha, branch or tag) and shows it. */
export function DeployPreview({ workspace, tenant, to }: { workspace: string; tenant: string; to: string }) {
  const [plan, setPlan] = useState<DeployPreviewPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/${encodeURIComponent(workspace)}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ to, dryRun: true }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as DeployPreviewPlan & { error?: string };
        if (!live) return;
        if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
        else setPlan(body);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [workspace, tenant, to]);

  if (error) return <p className="text-xs text-danger">Could not preview: {error}</p>;
  if (!plan) return <p className="text-xs text-fg-subtle">Working out what would change…</p>;
  if (plan.noop) return <p className="text-xs text-fg-muted">main already matches this tree. Deploying it would change nothing.</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-secondary">
        {plan.updated.length} changed, {plan.added.length} added, {plan.removed.length} removed. storage/, state/, runs, secrets and memory agents wrote are kept.
      </p>
      {plan.blockedBy.length > 0 && (
        <p className="text-xs text-warning">
          {plan.blockedBy.length} run{plan.blockedBy.length === 1 ? "" : "s"} in flight ({plan.blockedBy.join(", ")}) — the deploy is refused until they finish.
        </p>
      )}
      {plan.issues && plan.issues.length > 0 && (
        <div className="rounded-md border border-danger-line bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
          It would not pass the deploy checks:
          <ul className="mt-0.5 list-inside list-disc font-mono text-[11px]">
            {plan.issues.map((i, n) => (
              <li key={n}>{(i.where ? `${i.where}: ` : "") + i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="rounded-md border border-warning-line bg-warning-soft px-2.5 py-1.5 text-xs text-warning">
          It would deploy, with {plan.warnings.length === 1 ? "a warning" : "warnings"}:
          <ul className="mt-0.5 list-inside list-disc font-mono text-[11px]">
            {plan.warnings.map((i, n) => (
              <li key={n}>{(i.where ? `${i.where}: ` : "") + i.message}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-1">
        {plan.files.map((f) => (
          <li key={f.path} className="rounded border border-line bg-surface">
            <details>
              <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs">
                <Badge variant={f.change === "removed" ? "error" : f.change === "added" ? "success" : "info"}>{f.change}</Badge>
                <span className="truncate font-mono">{f.path}</span>
              </summary>
              <Diff ops={f.diff} />
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
