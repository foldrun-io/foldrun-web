"use client";

// One grader — an eval with `trigger: runs` — and what it has found: the pass
// rate over the window, a bar per day, the runs that failed and why, and a
// box to grade one run now (POST …/evals/<e>/grade). Nothing here starts a
// run; a grader only reads the ones that happened.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge, buttonClass, inputClass } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import { ExpandableTitle } from "@/components/expandable";
import { InlineEditor } from "@/components/inline-editor";
import { DeleteButton } from "../../manage";
import { runHref } from "@/components/run-href";
import { useCan } from "@/components/role";
import { WithEmails } from "@/components/email";
import type { EvalInfo } from "@/lib/evals";
import type { Grade, GradeSummary } from "@/lib/grades";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** The reason a grade failed, in one line: the first check that did not pass. */
export function gradeReason(g: Grade): string {
  for (const c of g.checks) {
    if (c.passed) continue;
    if (c.error) return `${c.name}: ${c.error}`;
    const a = c.assertions.find((x) => !x.passed);
    return `${c.name}: ${a ? `${a.type} — ${a.detail}` : "failed"}`;
  }
  return "";
}

export function GraderCard({
  workspace,
  tenant,
  info,
  summary,
  week,
  grades,
  extra,
}: {
  workspace: string;
  tenant: string;
  info: EvalInfo;
  /** The last 30 days. */
  summary: GradeSummary;
  /** The last 7. */
  week: GradeSummary;
  /** Newest first, at most a page of them. */
  grades: Grade[];
  /** Whatever the page adds under the grades — proposals, for one. */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const canRun = useCan("run:start");
  const [editing, setEditing] = useState(false);
  const [runId, setRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Grade | null>(null);

  const gradeOne = async () => {
    setBusy(true);
    setError(null);
    setFresh(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/evals/${encodeURIComponent(info.name)}/grade`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ run: runId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFresh(data as Grade);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const failures = grades.filter((g) => g.status === "fail").slice(0, 8);
  const days = summary.byDay.slice(-30);
  const tallest = Math.max(1, ...days.map((d) => d.graded));

  return (
    <CollapsibleCard
      id={anchorId("eval", info.name)}
      scope={`evals:${workspace}`}
      item={info.name}
      search={[info.name, info.file, info.flow ?? info.agent ?? ""].join(" ")}
      forceOpen={busy || !!error}
      title={info.name}
      meta={
        <>
          <Badge variant="info">{info.flow ? `flow: ${info.flow}` : `agent: ${info.agent}`}</Badge>
          <Badge title="The share of finished runs this grader reads, chosen by a hash of the run id — the same run is always in or out.">grades {info.sample}% of runs</Badge>
          <Badge>judge: {info.model}</Badge>
          {summary.graded > 0 ? (
            <Badge variant={week.rate === null ? "default" : week.rate >= 0.9 ? "success" : week.rate >= 0.7 ? "warning" : "error"} title={`${week.passed} passed, ${week.failed} failed in 7 days; ${pct(summary.rate)} over 30`}>
              {pct(week.rate)} passing · 7 days
            </Badge>
          ) : (
            <Badge>no runs graded yet</Badge>
          )}
          {info.improve && <Badge title={`A fix is proposed once ${info.improve} graded runs failed and nobody has looked.`}>improve after {info.improve}</Badge>}
          {info.problems.length > 0 && <Badge variant="error">cannot be read</Badge>}
        </>
      }
      actions={
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteButton
            endpoint={`/api/workspaces/${workspace}/source`}
            tenant={tenant}
            body={{ path: `evals/${info.file}` }}
            confirmText={`Delete grader ${info.name}? The grades it gave stay on disk until they age out.`}
          />
        </span>
      }
    >
      {info.problems.map((p) => (
        <p key={p} className="mb-1 text-xs text-red-600">
          <WithEmails text={p} />
        </p>
      ))}

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Stat label="Graded · 30 days" value={String(summary.graded)} />
        <Stat label="Passing · 30 days" value={pct(summary.rate)} />
        <Stat label="Failed · 30 days" value={String(summary.failed)} />
        <Stat label="Judges cost" value={`$${summary.costUsd.toFixed(4)}`} />
      </div>

      {days.length > 0 && (
        <div className="mb-3" aria-label="grades per day, passed over failed">
          <div className="flex h-12 items-end gap-0.5">
            {days.map((d) => (
              <div key={d.day} className="flex w-3 flex-col justify-end" title={`${d.day}: ${d.passed} passed, ${d.failed} failed of ${d.graded}`}>
                <div className="bg-red-400" style={{ height: `${(d.failed / tallest) * 48}px` }} />
                <div className="bg-emerald-500" style={{ height: `${(d.passed / tallest) * 48}px` }} />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">a bar per day graded — green passed, red failed</p>
        </div>
      )}

      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">Checks</p>
      <ul className="mb-3 space-y-1">
        {info.cases.map((c) => (
          <li key={c.name} className="rounded-lg border border-line bg-sunken/60 px-3 py-1.5 text-xs">
            <span className="font-medium text-fg">
              <WithEmails text={c.name} />
            </span>
            {c.expect.map((a, i) => (
              <span key={i} className="ml-2 text-fg-tertiary">
                <span className="font-mono">{a.type}:</span> <WithEmails text={a.value} />
              </span>
            ))}
          </li>
        ))}
      </ul>

      {failures.length > 0 && (
        <>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">Recent failures</p>
          <ul className="mb-3 space-y-1">
            {failures.map((g) => (
              <li key={g.runId} className="flex flex-wrap items-baseline gap-2 text-xs">
                <Link href={runHref(workspace, g.runId, tenant)} className="font-mono text-accent hover:underline">{g.runId}</Link>
                <span className="text-fg-muted">{g.at.slice(0, 16).replace("T", " ")}</span>
                <span className="text-red-700">
                  <WithEmails text={gradeReason(g)} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {extra}

      {canRun && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run-…" className={inputClass("w-56 font-mono text-xs")} aria-label="run id to grade" />
          <button onClick={gradeOne} disabled={busy || !runId.trim()} className={buttonClass("secondary")}>
            {busy ? "Grading…" : "Grade a run"}
          </button>
          {fresh && (
            <span className={`text-xs ${fresh.status === "pass" ? "text-emerald-700" : fresh.status === "fail" ? "text-red-700" : "text-amber-700"}`}>
              {fresh.status}
              {fresh.status !== "pass" && (
                <>
                  {" — "}
                  <WithEmails text={gradeReason(fresh)} />
                </>
              )}
            </span>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}

      <div className="mt-3">
        <ExpandableTitle open={editing} onToggle={() => setEditing((e) => !e)} name={`evals/${info.file}`} />
      </div>
      {editing && <InlineEditor workspace={workspace} tenant={tenant} path={`evals/${info.file}`} />}
    </CollapsibleCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="text-lg font-semibold text-fg">{value}</p>
    </div>
  );
}
