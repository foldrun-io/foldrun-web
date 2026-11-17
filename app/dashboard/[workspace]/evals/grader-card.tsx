"use client";

// One grader's own view (?eval=<name>) — an eval with `trigger: runs` — and
// what it has found: the pass rate over the window, a bar per day, the runs
// that failed and why, and a box to grade one run now (POST …/evals/<e>/grade).
// Nothing here starts a run; a grader only reads the ones that happened.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { Page, PageHeader, IconBox, Panel, PanelList, SummaryCard, StatGrid, Stat, Chip, type Tone, Callout } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Tooltip } from "@foldrun/ui/react/tooltip";
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
        back={{ href: listHref, label: $t("workspace.evals-grader-card.evals") }}
        icon={
          <IconBox>
            <Gauge />
          </IconBox>
        }
        title={info.name}
        badge={
          <>
            {summary.graded > 0 ? (
              <Tooltip label={$t("workspace.evals-grader-card.passedFailedIn7DaysOver", { passed: String(week.passed), failed: String(week.failed), v2: String(pct(summary.rate)) })}>
                <span>
                  <Chip tone={rateTone(week.rate)}>{$t("workspace.evals-grader-card.passing7Days", { pct: pct(week.rate) })}</Chip>
                </span>
              </Tooltip>
            ) : (
              <Chip>{$t("workspace.evals-grader-card.noRunsGradedYet")}</Chip>
            )}
            {info.problems.length > 0 && <Chip tone="bad">{$t("workspace.evals-grader-card.cannotBeRead")}</Chip>}
          </>
        }
        description={
          <>
            {$rich("workspace.evals-grader-card.gradesRealFinishedRunsOfAgainst", { kind: kind, target: target, span: (chunks) => <span className="font-medium text-fg">{chunks}</span> })}
          </>
        }
        actions={<EvalMenu workspace={workspace} tenant={tenant} file={info.file} listHref={listHref} confirmText={$t("workspace.evals-grader-card.deleteGraderTheGradesItGave", { name: String(info.name) })} />}
      />

      <div className="space-y-8 pb-12">
        {(info.problems.length > 0 || missingTarget) && (
          <Callout tone="danger" className="px-4 py-3 text-sm" bodyClassName="space-y-1">
            {missingTarget && <p>{$t("workspace.evals-grader-card.notFoundInThisTerm", { kind: kind, target: target })}</p>}
            {info.problems.map((p) => (
              <p key={p}>
                <WithEmails text={p} />
              </p>
            ))}
          </Callout>
        )}

        <SummaryCard
          items={[
            {
              label: kind === "flow" ? $t("workspace.evals-grader-card.flow") : $t("workspace.evals-grader-card.agent"),
              value: missingTarget ? (
                <span className="text-danger">{target}</span>
              ) : (
                <Link href={targetHref} className="hover:underline">
                  {target}
                </Link>
              ),
            },
            {
              label: $t("workspace.evals-grader-card.grades"),
              value: (
                <Tooltip label={$t("workspace.evals-grader-card.theShareOfFinishedRunsThis")}>
                  <span>{$t("workspace.evals-grader-card.ofRuns", { sample: String(info.sample) })}</span>
                </Tooltip>
              ),
            },
            { label: $t("workspace.evals-grader-card.judge"), value: <span className="font-mono">{info.model}</span> },
            {
              label: $t("workspace.evals-grader-card.proposesAFix"),
              value: info.improve ? (
                <Tooltip label={$t("workspace.evals-grader-card.aFixIsProposedOnceGraded", { improve: String(info.improve) })}>
                  <span>{$t("workspace.evals-grader-card.afterFailures", { improve: String(info.improve) })}</span>
                </Tooltip>
              ) : $t("workspace.evals-grader-card.onlyWhenAsked"),
            },
          ]}
        />

        <StatGrid>
          <Stat label={$t("workspace.evals-grader-card.graded30Days")} value={String(summary.graded)} />
          <Stat label={$t("workspace.evals-grader-card.passing30Days")} value={pct(summary.rate)} />
          <Stat label={$t("workspace.evals-grader-card.failed30Days")} value={String(summary.failed)} tone={summary.failed > 0 ? "danger" : undefined} />
          <Stat label={$t("workspace.evals-grader-card.judgesCost")} value={`$${summary.costUsd.toFixed(4)}`} />
        </StatGrid>

        {days.length > 0 && (
          <Panel title={$t("workspace.evals-grader-card.perDay")} description={$t("workspace.evals-grader-card.aBarPerDayGradedPassed")}>
            <div className="flex h-16 items-end gap-1 overflow-x-auto" aria-label={$t("workspace.evals-grader-card.gradesPerDayPassedOverFailed")}>
              {days.map((d) => (
                <Tooltip key={d.day} label={$t("workspace.evals-grader-card.passedFailedOf", { day: String(d.day), passed: String(d.passed), failed: String(d.failed), graded: String(d.graded) })}>
                  <div className="flex w-3 shrink-0 flex-col justify-end gap-px">
                    <div className="rounded-t-sm bg-danger" style={{ height: `${(d.failed / tallest) * 64}px` }} />
                    <div className="rounded-b-sm bg-success" style={{ height: `${(d.passed / tallest) * 64}px` }} />
                  </div>
                </Tooltip>
              ))}
            </div>
          </Panel>
        )}

        <Panel title={$t("workspace.evals-grader-card.checks")} description={$t("workspace.evals-grader-card.whatEveryGradedRunIsHeld")} flush>
          {info.cases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">{$t("workspace.evals-grader-card.noChecksYet")}</p>
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
          <Panel title={$t("workspace.evals-grader-card.recentFailures")} flush>
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
          <Panel title={$t("workspace.evals-grader-card.proposedFixes")} description={$t("workspace.evals-grader-card.theAssistantReadsTheFailuresAnd")}>
            {extra}
          </Panel>
        )}

        {canRun && (
          <Panel title={$t("workspace.evals-grader-card.gradeARun")} description={$t("workspace.evals-grader-card.gradeOneFinishedRunNowWhether")}>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (runId.trim() && !busy) void gradeOne();
              }}
            >
              <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run-…" className="w-64 max-w-full font-mono text-[13px]" aria-label={$t("workspace.evals-grader-card.runIdToGrade")} />
              <Button type="submit" disabled={busy || !runId.trim()}>
                {busy ? "Grading…" : $t("workspace.evals-grader-card.gradeARun")}
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
