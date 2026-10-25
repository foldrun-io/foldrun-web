// One run, on a page of its own. Everything about it, in the order a person
// asks: what was this and how did it end; if it went wrong, where; how this
// flow has been doing; then the run itself — timeline, steps, the browser,
// the trace. Older and newer runs are an arrow key away.

import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listRuns, listRunOutputs, readRun, runCost, runTokens, measuredHitRate, runDisplayStatus, runDurationSecs, runFailure, runVerdict } from "@/lib/store";
import { LiveRun } from "../../live-run";
import { OUTCOME, outcomeOf, tally } from "@/components/outcome-model";
import { runHref } from "@/components/run-href";
import { runLite } from "@/server/run-lite";
import { runCharges, runCharge } from "@/server/run-charges";
import { credits } from "@/components/money";
import { RunPageKeys } from "@/components/run-page-nav";
import { LocalTime } from "@/components/local-time";
import { fmtSpan } from "@/components/mission-model";
import { fmtTokenDetail, fmtTokenLine } from "@/components/step-io-model";
import { WorkspaceHeader } from "@/components/workspace-header";
import { AskAiButton } from "@/components/assistant";
import { gradesOfRun } from "@/lib/grades";
import { WithEmails } from "@/components/email";
import { anchorId } from "@/components/collapse-model";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; runId: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace, runId } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  const run = readRun(tenant, workspace, runId);
  if (!run) notFound();

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const all = listRuns(tenant, workspace); // newest first
  const at = all.findIndex((r) => r.id === run.id);
  const newer = at > 0 ? all[at - 1] : null;
  const older = at >= 0 && at < all.length - 1 ? all[at + 1] : null;
  const charges = await runCharges(tenant);
  const same = all.filter((r) => r.flow === run.flow).slice(0, 40).reverse().map((r) => runLite({ ...r, workspace }, charges));

  const status = runDisplayStatus(run);
  const verdict = run.status === "completed" ? runVerdict(run) : null;
  const outcome = outcomeOf(status, verdict);
  const o = OUTCOME[outcome];
  const failure = runFailure(run);
  const failedStep = failure ? run.steps.findIndex((s) => s.agent === failure.agent && s.status === "failed") : -1;
  const duration = runDurationSecs(run);
  const cost = runCost(run);
  const tokens = runTokens(run);
  const done = run.steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const what = run.flow.startsWith("adhoc:") ? run.flow.slice(6) : run.flow.startsWith("eval:") ? run.flow.slice(5) : run.flow;
  const kind = run.flow.startsWith("adhoc:") ? "agent" : run.flow.startsWith("eval:") ? "eval" : "flow";
  const listHref = `/dashboard/${workspace}/runs${qs}`;
  const olderHref = older ? runHref(workspace, older.id, tenant) : null;
  const newerHref = newer ? runHref(workspace, newer.id, tenant) : null;
  const headline = run.summary?.trim() || null;
  // What the graders (evals with trigger: runs) said about this run.
  let grades: ReturnType<typeof gradesOfRun> = [];
  try {
    grades = gradesOfRun(tenant, workspace, run.id);
  } catch {
    /* a grader that cannot be read grades nothing here */
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <RunPageKeys older={olderHref} newer={newerHref} list={listHref} />
      <WorkspaceHeader workspace={workspace} qs={qs} />

      {/* Where you are, and the way to the next one. */}
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/dashboard${qs}`} className="text-fg-muted hover:text-fg">All workspaces</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/dashboard/${workspace}${qs}`} className="text-fg-muted hover:text-fg">{workspace}</Link>
        <span className="text-gray-300">/</span>
        <Link href={listHref} className="text-fg-muted hover:text-fg">Runs</Link>
        <span className="text-gray-300">/</span>
        <span className="font-mono text-fg">{run.id}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Link
            href={olderHref ?? "#"}
            aria-disabled={!olderHref}
            className={`rounded-md border border-line px-2.5 py-1 text-xs font-medium ${olderHref ? "text-fg-secondary hover:bg-sunken" : "pointer-events-none text-gray-300"}`}
            title="Older run (←)"
          >
            ← older
          </Link>
          <Link
            href={newerHref ?? "#"}
            aria-disabled={!newerHref}
            className={`rounded-md border border-line px-2.5 py-1 text-xs font-medium ${newerHref ? "text-fg-secondary hover:bg-sunken" : "pointer-events-none text-gray-300"}`}
            title="Newer run (→)"
          >
            newer →
          </Link>
          <span className="hidden text-[11px] text-fg-subtle lg:inline">
            <kbd className="rounded border border-line px-1">←</kbd> <kbd className="rounded border border-line px-1">→</kbd> runs · <kbd className="rounded border border-line px-1">u</kbd> list
          </span>
        </span>
      </nav>

      {/* The answer first: what this was and how it ended. */}
      <section className="mb-5 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="p-5">
          <div className="flex flex-wrap items-start gap-4">
          <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${o.pill}`}>
            <span className={`h-2 w-2 rounded-full ${o.dot}`} />
            {o.label}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-fg-subtle">{kind}</p>
            <h1 className="truncate text-xl font-semibold text-fg">{what}</h1>
            {(run.revision || run.drivenAt) && (
              <p className="mt-0.5 text-[11px] text-fg-muted">
                {run.revision && <span title={`deployed commit ${run.revision} — the files this run ran`}>ran on <span className="font-mono">{run.revision.slice(0, 7)}</span></span>}
                {run.revision && run.drivenAt && " · "}
                {run.drivenAt && <span title="from the run being created to a worker picking it up">queued {fmtSpan(Math.max(0, Date.parse(run.drivenAt) - Date.parse(run.startedAt)))}</span>}
              </p>
            )}
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid-cols-5">
            {[
              ["started", <LocalTime key="t" iso={run.startedAt} />],
              ["took", duration ? fmtSpan(duration * 1000) : "—"],
              ["steps", `${done}/${run.steps.length}`],
              [
                charges.usd.has(run.id) ? "charged" : "est. charge",
                <span key="c" title={`${charges.usd.has(run.id) ? "What the ledger charged" : "List price — the run is not settled yet"}${cost ? ` · token cost $${cost.toFixed(4)}` : ""}`}>
                  {runCharge(run, charges) ? credits(runCharge(run, charges)) : "—"}
                </span>,
              ],
              ["tokens", <span key="k" title={fmtTokenDetail(tokens) ?? undefined}>{fmtTokenLine(tokens, measuredHitRate(run.steps.map((s) => s.tokens))) ?? "—"}</span>],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[10px] uppercase tracking-wide text-fg-subtle">{k}</dt>
                <dd className="text-sm tabular-nums text-fg">{v}</dd>
              </div>
            ))}
          </dl>
          </div>
          {headline && <p className="mt-3 line-clamp-4 break-words text-[15px] leading-relaxed text-fg-secondary">{headline}</p>}
        </div>

        {/* If it went wrong, where — one click to the step. */}
        {failure && (
          <a
            href={failedStep >= 0 ? `#step-${failedStep + 1}` : "#"}
            className="flex items-start gap-3 border-t border-red-100 bg-red-50/70 px-5 py-3 text-sm hover:bg-red-50"
          >
            <span className="mt-0.5 font-bold text-red-600">✗</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-red-800">{failedStep >= 0 ? `Step ${failedStep + 1} · ` : ""}{failure.agent}</span>
              <span className="block break-words font-mono text-[12px] text-red-700">{failure.reason}</span>
            </span>
            {failedStep >= 0 && <span className="shrink-0 text-xs font-medium text-red-700">go to step →</span>}
          </a>
        )}
        {!failure && (outcome === "blocked" || outcome === "bad") && headline && (
          <div className={`flex items-start gap-3 border-t px-5 py-3 text-sm ${outcome === "bad" ? "border-rose-100 bg-rose-50/70 text-rose-800" : "border-orange-100 bg-orange-50/70 text-orange-800"}`}>
            <span className="mt-0.5 font-bold">!</span>
            <span>The run completed, and the agent reported {verdict}. The last step says why, below.</span>
          </div>
        )}
        {/* The run doctor (FOL-22): the assistant reads this run and the
            files it names, says why, and proposes the fix as files to save. */}
        {/* outcome, not runFailure: a run can fail with no failed step
            (a budget hit between groups), and that one needs it too. */}
        {(failure || outcome === "failed" || outcome === "blocked" || outcome === "bad") && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-faint px-5 py-2.5">
            <span className="min-w-0 flex-1 text-xs text-fg-muted">
              The run doctor reads this run and its files, says what went wrong and proposes the fix. Nothing changes until you save it.
            </span>
            <AskAiButton
              label="Doctor"
              title="The run doctor: open Ask AI with this run"
              prompt={`Doctor: why did run ${run.id} ${failure || outcome === "failed" ? "fail" : `end ${verdict}`}, and how do I fix it?`}
            />
          </div>
        )}

        {/* What the graders said about this run: one line per grader, the
            first check that did not pass when one did not. */}
        {grades.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-line-faint px-5 py-2.5">
            {grades.map((g) => {
              const miss = g.checks.find((c) => !c.passed);
              const why = miss ? (miss.error ?? miss.assertions.find((a) => !a.passed)?.detail ?? "") : "";
              return (
                <p key={g.eval} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${g.status === "pass" ? "bg-emerald-50 text-emerald-700" : g.status === "fail" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                    {g.status === "pass" ? "graded: pass" : g.status === "fail" ? "graded: fail" : "not decided"}
                  </span>
                  <Link href={`/dashboard/${workspace}/evals${qs}#${anchorId("eval", g.eval)}`} className="font-medium text-fg hover:underline">{g.eval}</Link>
                  {miss && (
                    <span className="text-fg-muted">
                      <WithEmails text={`${miss.name}: ${why}`} />
                    </span>
                  )}
                  <span className="text-fg-subtle">{g.by === "sample" ? "sampled" : <>asked by <WithEmails text={g.by} /></>} · {g.at.slice(0, 16).replace("T", " ")} UTC</span>
                </p>
              );
            })}
          </div>
        )}

        {/* How this flow has been doing: its recent runs, this one ringed. */}
        {same.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line-faint bg-sunken/60 px-5 py-2.5">
            <span className="text-[11px] text-fg-muted">This {kind}&apos;s last {same.length} runs</span>
            <span className="flex items-center gap-[3px]">
              {same.map((r) => (
                <Link
                  key={r.id}
                  href={runHref(workspace, r.id, tenant)}
                  title={`${OUTCOME[r.outcome].hint} · ${r.startedAt.slice(0, 16).replace("T", " ")} UTC${r.headline ? `\n${r.headline}` : ""}`}
                  className={`h-4 w-2.5 rounded-[2px] ${OUTCOME[r.outcome].cell} ${r.id === run.id ? "ring-2 ring-gray-900 ring-offset-1" : "hover:scale-y-125"} transition-transform`}
                />
              ))}
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-fg-muted">
              {(() => {
                // The shared completion rate (core outcome.ts).
                const t = tally(same.map((r) => r.outcome));
                return t.completedPct === null ? "" : `${t.completedPct}% completed`;
              })()}
            </span>
          </div>
        )}
      </section>

      <LiveRun
        key={run.id}
        compactHeader
        workspace={workspace}
        tenant={tenant}
        initial={run}
        outputs={listRunOutputs(tenant, workspace, run.id)}
      />
    </main>
  );
}
