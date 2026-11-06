"use client";

// One grader's own view (?eval=<name>) — an eval with `trigger: runs` — and
// what it has found: the pass rate over the window, a bar per day, the runs
// that failed and why, and a box to grade one run now (POST …/evals/<e>/grade).
// Nothing here starts a run; a grader only reads the ones that happened.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { Page, PageHeader, IconBox, Panel, PanelList, SummaryCard, StatGrid, Stat, Chip, type Tone } from "@/components/kit/page";
import { Button } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { EvalMenu } from "./eval-actions";
import { EvalSource } from "./eval-card";
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

export function GraderDetail({
  workspace,
  tenant,
  info,
  summary,
  week,
  grades,
  extra,
  listHref,
  targetHref,
  missingTarget = false,
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
  listHref: string;
  targetHref: string;
  missingTarget?: boolean;
}) {
  const router = useRouter();
  const canRun = useCan("run:start");
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
  const kind = info.flow ? "flow" : "agent";
  const target = info.flow ?? info.agent ?? "";

  return (
    <Page>
      <PageHeader
        back={{ href: listHref, label: "Evals" }}
        icon={
          <IconBox>
            <Gauge />
          </IconBox>
        }
        title={info.name}
        badge={
          <>
            {summary.graded > 0 ? (
              <span title={`${week.passed} passed, ${week.failed} failed in 7 days; ${pct(summary.rate)} over 30`}>
                <Chip tone={rateTone(week.rate)}>{pct(week.rate)} passing · 7 days</Chip>
              </span>
            ) : (
              <Chip>no runs graded yet</Chip>
            )}
            {info.problems.length > 0 && <Chip tone="bad">cannot be read</Chip>}
          </>
        }
        description={
          <>
            Grades real finished runs of {kind} <span className="font-medium text-fg">{target}</span> against its checks.
          </>
        }
        actions={<EvalMenu workspace={workspace} tenant={tenant} file={info.file} listHref={listHref} confirmText={`Delete grader ${info.name}? The grades it gave stay on disk until they age out.`} />}
      />

      <div className="space-y-8 pb-12">
        {(info.problems.length > 0 || missingTarget) && (
          <div className="space-y-1 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
            {missingTarget && <p>{kind} &quot;{target}&quot; not found in this workspace.</p>}
            {info.problems.map((p) => (
              <p key={p}>
                <WithEmails text={p} />
              </p>
            ))}
          </div>
        )}

        <SummaryCard
          items={[
            {
              label: kind === "flow" ? "Flow" : "Agent",
              value: missingTarget ? (
                <span className="text-danger">{target}</span>
              ) : (
                <Link href={targetHref} className="hover:underline">
                  {target}
                </Link>
              ),
            },
            {
              label: "Grades",
              value: <span title="The share of finished runs this grader reads, chosen by a hash of the run id — the same run is always in or out.">{info.sample}% of runs</span>,
            },
            { label: "Judge", value: <span className="font-mono">{info.model}</span> },
            {
              label: "Proposes a fix",
              value: info.improve ? <span title={`A fix is proposed once ${info.improve} graded runs failed and nobody has looked.`}>after {info.improve} failures</span> : "Only when asked",
            },
          ]}
        />

        <StatGrid>
          <Stat label="Graded · 30 days" value={String(summary.graded)} />
          <Stat label="Passing · 30 days" value={pct(summary.rate)} />
          <Stat label="Failed · 30 days" value={String(summary.failed)} tone={summary.failed > 0 ? "danger" : undefined} />
          <Stat label="Judges cost" value={`$${summary.costUsd.toFixed(4)}`} />
        </StatGrid>

        {days.length > 0 && (
          <Panel title="Per day" description="A bar per day graded — passed under failed.">
            <div className="flex h-16 items-end gap-1 overflow-x-auto" aria-label="grades per day, passed over failed">
              {days.map((d) => (
                <div key={d.day} className="flex w-3 shrink-0 flex-col justify-end gap-px" title={`${d.day}: ${d.passed} passed, ${d.failed} failed of ${d.graded}`}>
                  <div className="rounded-t-sm bg-danger" style={{ height: `${(d.failed / tallest) * 64}px` }} />
                  <div className="rounded-b-sm bg-success" style={{ height: `${(d.passed / tallest) * 64}px` }} />
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Checks" description="What every graded run is held to." flush>
          {info.cases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">No checks yet.</p>
          ) : (
            <PanelList>
              {info.cases.map((c) => (
                <li key={c.name} className="space-y-1 px-5 py-3">
                  <p className="text-sm font-medium text-fg">
                    <WithEmails text={c.name} />
                  </p>
                  {c.expect.map((a, i) => (
                    <p key={i} className="text-[13px] text-fg-secondary [overflow-wrap:anywhere]">
                      <span className="font-mono text-fg-muted">{a.type}:</span> <WithEmails text={a.value} />
                    </p>
                  ))}
                </li>
              ))}
            </PanelList>
          )}
        </Panel>

        {failures.length > 0 && (
          <Panel title="Recent failures" flush>
            <PanelList>
              {failures.map((g) => (
                <li key={g.runId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
                  <Link href={runHref(workspace, g.runId, tenant)} className="font-mono text-[13px] text-link hover:underline">
                    {g.runId}
                  </Link>
                  <span className="text-[13px] text-fg-muted">{g.at.slice(0, 16).replace("T", " ")}</span>
                  <span className="min-w-0 text-danger [overflow-wrap:anywhere]">
                    <WithEmails text={gradeReason(g)} />
                  </span>
                </li>
              ))}
            </PanelList>
          </Panel>
        )}

        {extra && (
          <Panel title="Proposed fixes" description="The assistant reads the failures and proposes the smallest change. Nothing is written until you apply it.">
            {extra}
          </Panel>
        )}

        {canRun && (
          <Panel title="Grade a run" description="Grade one finished run now, whether or not it is in the sample.">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (runId.trim() && !busy) void gradeOne();
              }}
            >
              <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run-…" className="w-64 max-w-full font-mono text-[13px]" aria-label="run id to grade" />
              <Button type="submit" disabled={busy || !runId.trim()}>
                {busy ? "Grading…" : "Grade a run"}
              </Button>
              {fresh && (
                <span className={`text-sm ${fresh.status === "pass" ? "text-success" : fresh.status === "fail" ? "text-danger" : "text-warning"}`}>
                  {fresh.status}
                  {fresh.status !== "pass" && (
                    <>
                      {" — "}
                      <WithEmails text={gradeReason(fresh)} />
                    </>
                  )}
                </span>
              )}
              {error && <span className="text-sm text-danger">{error}</span>}
            </form>
          </Panel>
        )}

        <EvalSource workspace={workspace} tenant={tenant} name={info.name} file={info.file} />
      </div>
    </Page>
  );
}

/** A 7-day pass rate as a chip's tone. */
function rateTone(rate: number | null): Tone {
  return rate === null ? "default" : rate >= 0.9 ? "good" : rate >= 0.7 ? "warn" : "bad";
}
