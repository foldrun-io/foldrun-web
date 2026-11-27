// Observability for one workspace: what the agents actually did, read from
// the run journals that already hold every fact.
//
// The Usage page answers "what did this spend". This page answers what a
// developer asks when something is wrong: which agent fails, which one has to
// retry, which tool errors and how slow it is, what the last failures said —
// and every number here can be checked against the run it came from, because
// nothing is instrumented separately: it is all read out of runs/*.json.
//
// Numbers carry their honesty: a percentile only appears over enough samples
// (the aggregation returns null otherwise, and the page prints an em dash),
// and tool latency is only shown for tools that measured their own — a
// built-in's gap-to-next-event includes the model thinking, so inventing a
// latency from it would be worse than not showing one.

import { $el, $rich, $t, localizedList } from "@/i18n";
import { creditsShort } from "@/components/money";
import { runCharges } from "@/server/run-charges";
import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { observeWorkspace, type Sampled } from "@/platform/observe";
import { evalTrends } from "@/lib/evals";
import { Activity, Braces } from "lucide-react";
import { Page, PageHeader, Panel, PanelList, Stat, StatGrid, EmptyState, Chip } from "@foldrun/ui/react/page";
import { Table, THead, TBody, TR, TH, TD } from "@foldrun/ui/react/table";
import { buttonVariants } from "@foldrun/ui/react/button";
import { ChartLegend } from "@foldrun/ui/react/chart";
import { Segmented } from "@foldrun/ui/react/segmented";
import { Tooltip } from "@foldrun/ui/react/tooltip";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

const WINDOWS = localizedList(() => [
  { days: 7, label: $t("workspace.observe-page.7Days") },
  { days: 30, label: $t("workspace.observe-page.30Days") },
  { days: 90, label: $t("workspace.observe-page.90Days") },
]);

const secs = (v: number | null) => (v === null ? "—" : v >= 100 ? `${Math.round(v)}s` : `${v.toFixed(1)}s`);
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
/** Seconds that are often under one — start-up phases — read as ms below a second. */
const fine = (v: number | null) => ms(v === null ? null : v * 1000);
// Credits charged (FOL-54): the ledger's figure, list price for a run not
// settled yet. Token cost is not the bill.
const usd = (v: number) => creditsShort(v);
// Deterministic grouping — toLocaleString on the server formats with the
// BOX's locale, and this page renders on the server.
const num = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** Characters as a reader sizes them: 52k, 1.2M. */
const chars = (v: number | null) =>
  v === null ? "—" : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
const count = (v: number | null) => (v === null ? "—" : String(Math.round(v)));

/** p50 / p95 with the sample count they rest on, or just the worst case. */
function Spread({ s, unit }: { s: Sampled; unit: (v: number | null) => string }) {
  if (s.n === 0) return <span className="text-fg-subtle">—</span>;
  if (s.p50 === null) {
    // Too few to summarise; the worst one is still a fact.
    return (
      <Tooltip label={$t("workspace.observe-page.sampleTooFewForPercentiles", { n: String(s.n), v1: s.n })}>
        <span className="text-fg-tertiary">
          ≤{unit(s.max)} <span className="text-fg-subtle">(n={s.n})</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={$t("workspace.observe-page.overSamples", { n: String(s.n) })}>
      <span className="text-fg-tertiary">
        {unit(s.p50)} <span className="text-fg-subtle">/ p95 {unit(s.p95)}</span>
      </span>
    </Tooltip>
  );
}

/** A short commit: a git sha, or a revision id (r-…) when it was edited here. */
const shortRev = (c: string) => (c.startsWith("r-") ? c.slice(0, 12) : c.slice(0, 7));
const dash = <span className="text-fg-subtle">—</span>;

export default async function ObservePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; since?: string }>;
}) {
  await requestLocale();
  const { workspace } = await params;
  const { tenant = "default", since } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const sinceDays = Math.min(Math.max(Number(since) || 30, 1), 365);
  // Money is what the account was charged (FOL-54), from the ledger.
  const o = observeWorkspace(tenant, workspace, sinceDays, undefined, await runCharges(tenant));
  // Independent of the window: a regression is a comparison between two
  // commits, whenever they ran.
  const trends = evalTrends(tenant, workspace);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const runHref = (runId: string) => `/dashboard/${workspace}/runs/${runId}${tenantParam.replace("&", "?")}`;

  // The daily strip scales to its own worst day, so a quiet workspace still
  // shows shape instead of six invisible one-pixel bars.
  const maxDayRuns = Math.max(1, ...o.days.map((d) => d.runs));
  const windowLabel = WINDOWS.find((w) => w.days === sinceDays)?.label ?? `${sinceDays} days`;

  return (
    <Page width="wide">
      <PageHeader
        title={$t("workspace.observe-page.observe")}
        description={$t("workspace.observe-page.whatTheAgentsHereActuallyDid")}
        actions={
          <>
            {/* The window, stated and switchable. Every number below describes it. */}
            <Segmented
              label={$t("workspace.observe-page.window")}
              value={String(sinceDays)}
              items={WINDOWS.map((w) => ({ key: String(w.days), label: w.label, href: `/dashboard/${workspace}/observe?since=${w.days}${tenantParam}` }))}
            />
            <Link href={`/v1/workspaces/${workspace}/observe?since=${sinceDays}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
              <Braces aria-hidden />
              {$t("workspace.observe-page.json")}
            </Link>
          </>
        }
      />

      <div className="space-y-8">
        {/* The thing no proxy-shaped observability tool can do: quality,
            attributed to the commit that changed it. Every eval run is stamped
            with the commit the workspace was running; a drop names the change.
            Compared against the previous DIFFERENT commit, not the previous
            run — two runs on one commit differ only by the model's mood. */}
        {trends.length > 0 && (
          <Panel title={$t("workspace.observe-page.evalsByChange")} description={$t("workspace.observe-page.eachEvalSLatestScoreAgainst")} flush>
            <Table className="min-w-[560px]">
              <THead>
                <tr>
                  <TH>{$t("workspace.observe-page.eval")}</TH>
                  <TH>{$t("workspace.observe-page.now")}</TH>
                  <TH>{$t("workspace.observe-page.at")}</TH>
                  <TH>{$t("workspace.observe-page.before")}</TH>
                  <TH>{$t("workspace.observe-page.change")}</TH>
                </tr>
              </THead>
              <TBody>
                {trends.map((t) => {
                  const total = t.latest.passed + t.latest.failed;
                  const dropped = t.delta !== null && t.delta < 0;
                  const improved = t.delta !== null && t.delta > 0;
                  return (
                    <TR key={t.eval}>
                      <TD className="font-medium text-fg">
                        <Link href={`/dashboard/${workspace}/evals${qs}`} className="hover:underline">
                          {t.eval}
                        </Link>
                      </TD>
                      <TD className={dropped ? "font-medium text-danger" : "text-fg"}>
                        {t.latest.passed}/{total}
                      </TD>
                      <TD className="font-mono text-xs text-fg-muted">
                        {/* Either names the change — History on the file shows it. */}
                        {t.latest.commit ? shortRev(t.latest.commit) : <span className="font-sans text-fg-subtle">{$t("workspace.observe-page.noChangeOnRecord")}</span>}
                      </TD>
                      <TD className="text-fg-muted">
                        {t.previous ? (
                          <>
                            {t.previous.passed}/{t.previous.passed + t.previous.failed}
                            <span className="ms-1.5 font-mono text-xs text-fg-subtle">{t.previous.commit ? shortRev(t.previous.commit) : "—"}</span>
                          </>
                        ) : (
                          <span className="text-fg-subtle">{$t("workspace.observe-page.firstCommitWithARun")}</span>
                        )}
                      </TD>
                      <TD>
                        {t.delta === null ? (
                          dash
                        ) : dropped ? (
                          <Chip tone="bad">{$t("workspace.observe-page.thisChangeMadeItWorse", { delta: String(t.delta) })}</Chip>
                        ) : improved ? (
                          <Chip tone="good">+{t.delta}</Chip>
                        ) : (
                          <span className="text-fg-subtle">{$t("workspace.observe-page.unchanged")}</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Panel>
        )}

        {o.runs === 0 ? (
          <EmptyState
            icon={<Activity />}
            title={$t("workspace.observe-page.nothingRanInThisWindow")}
            description={$t("workspace.observe-page.widenTheWindowOrStartA")}
          />
        ) : (
          <>
            <StatGrid className="xl:grid-cols-5">
              <Stat label={$t("workspace.observe-page.runs")} value={o.runs} sub={$t("workspace.observe-page.inWindow", { window: windowLabel })} />
              <Stat label={$t("workspace.observe-page.failedRuns")} value={o.failedRuns} tone={o.failedRuns > 0 ? "danger" : undefined} />
              <Stat label={$t("workspace.observe-page.steps")} value={o.steps} />
              <Stat label={$t("workspace.observe-page.charged")} value={usd(o.chargedUsd)} />
              <Stat label={$t("workspace.observe-page.completed")} value={o.tally.completedPct === null ? "—" : `${o.tally.completedPct}%`} />
            </StatGrid>

            {/* Day by day: volume with failures burned in. A bar is a link to
                nothing — the table of failures below is where names live. */}
            <Panel title={$t("workspace.observe-page.runsByDay")}>
              <ChartLegend
                className="mb-4"
                items={[
                  { key: "runs", label: "runs", swatch: "bg-muted-strong" },
                  { key: "failed", label: "failed", swatch: "bg-danger" },
                ]}
                aside={$t("workspace.observe-page.busiestDayRun", { maxDayRuns: String(maxDayRuns), v1: maxDayRuns })}
              />
              <div className="flex h-28 items-end gap-[2px] border-b border-line">
                {o.days.map((d) => {
                  const h = Math.max(4, Math.round((d.runs / maxDayRuns) * 100));
                  const failH = d.runs ? (d.failed / d.runs) * h : 0;
                  return (
                    <Tooltip key={d.day} label={$t("workspace.observe-page.runFailed", { day: String(d.day), runs: String(d.runs), v2: d.runs, failed: String(d.failed), v4: String(usd(d.chargedUsd)) })}>
                      <div className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-sm hover:bg-sunken">
                        {failH > 0 && <div className="w-full rounded-t-sm bg-danger" style={{ height: `${failH}%` }} />}
                        <div className={`w-full bg-muted-strong ${failH > 0 ? "" : "rounded-t-sm"}`} style={{ height: `${h - failH}%` }} />
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              {o.days.length > 0 && (
                <div className="mt-1.5 flex justify-between text-xs tabular-nums text-fg-subtle">
                  <span>{o.days[0].day.slice(5).replace("-", "/")}</span>
                  <span>{o.days[o.days.length - 1].day.slice(5).replace("-", "/")}</span>
                </div>
              )}
            </Panel>

            {/* Agents: the who. Sorted by cost because "which agent burns the
                most" is the first question, but failures and retries are the
                columns this page exists for. */}
            <Panel title={$t("workspace.observe-page.agents")} description={$t("workspace.observe-page.sortedByCreditsPercentilesAppearOnce")} flush>
              <Table className="min-w-[760px]">
                <THead>
                  <tr>
                    <TH>{$t("workspace.observe-page.agent")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.steps")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.failed")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.retried")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.skipped")}</TH>
                    <TH>{$t("workspace.observe-page.stepTime")}</TH>
                    <Tooltip label={$t("workspace.observe-page.modelTurnsPerStepTheAgent")}><TH>{$t("workspace.observe-page.turns")}</TH></Tooltip>
                    <TH>{$t("workspace.observe-page.tokensInOut")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.cached")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.credits")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {o.agents.map((a) => (
                    <TR key={a.agent}>
                      <TD className="font-medium text-fg">
                        <Link href={`/dashboard/${workspace}/agents${qs}`} className="hover:underline">
                          {a.agent}
                        </Link>
                      </TD>
                      <TD className="text-end tabular-nums">{a.steps}</TD>
                      <TD className={`text-end tabular-nums ${a.failed ? "font-medium text-danger" : "text-fg-subtle"}`}>{a.failed || "—"}</TD>
                      <TD className={`text-end tabular-nums ${a.retried ? "font-medium text-warning" : "text-fg-subtle"}`}>{a.retried || "—"}</TD>
                      <TD className="text-end tabular-nums text-fg-muted">{a.skipped || "—"}</TD>
                      <TD>
                        <Spread s={a.seconds} unit={secs} />
                      </TD>
                      <Tooltip label={a.systemPromptChars?.max != null ? $t("workspace.observe-page.systemPromptCharactersSentOnEvery", { v0: String(chars(a.systemPromptChars.max)) }) : undefined} side="bottom">
                        <TD>
                          {a.turns ? <Spread s={a.turns} unit={count} /> : dash}
                        </TD>
                      </Tooltip>
                      <TD className="tabular-nums text-fg-muted">
                        {num(a.inputTokens)} / {num(a.outputTokens)}
                      </TD>
                      <Tooltip label={a.cacheHitRate == null ? $t("workspace.observe-page.noStepReportsCacheReadsYet") : $t("workspace.observe-page.inputTokensReadFromThePrompt", { v0: String(num(a.cacheReadTokens)) })}>
                        <TD className="text-end tabular-nums text-fg-muted">
                          {a.cacheHitRate == null ? "—" : `${Math.round(a.cacheHitRate * 100)}%`}
                        </TD>
                      </Tooltip>
                      <TD className="text-end tabular-nums text-fg">{usd(a.chargedUsd)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>

            {/* Tools: the what-with. Latency only where the tool measured its
                own; a built-in shows calls and an em dash, deliberately. */}
            {o.tools.length > 0 && (
              <Panel title={$t("workspace.observe-page.tools")} description={$t("workspace.observe-page.latencyOnlyWhereAToolTimes")} flush>
                <Table className="min-w-[640px]">
                  <THead>
                    <tr>
                      <TH>{$t("workspace.observe-page.tool")}</TH>
                      <TH className="text-end">{$t("workspace.observe-page.calls")}</TH>
                      <TH className="text-end">{$t("workspace.observe-page.errors")}</TH>
                      <TH>{$t("workspace.observe-page.latency")}</TH>
                      <Tooltip label={$t("workspace.observe-page.charactersEachResultPutIntoThe")}><TH>{$t("workspace.observe-page.resultSize")}</TH></Tooltip>
                      <TH>{$t("workspace.observe-page.calledBy")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {o.tools.map((t) => (
                      <TR key={t.name}>
                        <TD className="font-mono text-xs text-fg">{t.name}</TD>
                        <TD className="text-end tabular-nums">{t.calls}</TD>
                        <TD className={`text-end tabular-nums ${t.errors ? "font-medium text-danger" : "text-fg-subtle"}`}>{t.errors || "—"}</TD>
                        <TD>
                          {t.measured === 0 ? (
                            <Tooltip label={$t("workspace.observe-page.thisToolDoesNotReportIts")}>
                              <span className="text-fg-subtle">
                                —
                              </span>
                            </Tooltip>
                          ) : (
                            <Spread s={t.ms} unit={ms} />
                          )}
                        </TD>
                        <Tooltip label={t.resultSize && t.resultSize.n > 0 ? $t("workspace.observe-page.charactersOverResultsOver10k", { v0: String(num(t.resultChars)), n: String(t.resultSize.n), heavyCalls: String(t.heavyCalls) }) : $t("workspace.observe-page.noResultSizesRecordedYetFrom")} side="bottom">
                          <TD>
                            {t.resultSize && t.resultSize.n > 0 ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Spread s={t.resultSize} unit={chars} />
                                {t.heavyCalls > 0 && <Chip tone="warn">{$t("workspace.observe-page.heavy", { heavyCalls: String(t.heavyCalls) })}</Chip>}
                              </span>
                            ) : (
                              dash
                            )}
                          </TD>
                        </Tooltip>
                        <TD className="text-xs text-fg-muted">{t.agents.join(", ")}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Panel>
            )}

            {/* Start-up: where a step's first seconds go before the model
                speaks, phase by phase (FOL-29). Each phase's own share, and
                when it began and ended counted from the step's start. A
                services phase that booted beside the step pod is its own lane
                (FOL-74): it starts at 0, and go starts when it was up. */}
            {o.startup.length > 0 && (
              <Panel title={$t("workspace.observe-page.startUp")} description={$t("workspace.observe-page.whereAStepSFirstSeconds")} flush>
                <Table className="min-w-[560px]">
                  <THead>
                    <tr>
                      <Tooltip label={$t("workspace.observe-page.inTheOrderAStepGoes")}><TH>{$t("workspace.observe-page.phase")}</TH></Tooltip>
                      <Tooltip label={$t("workspace.observe-page.thisPhaseSOwnShareFrom")}><TH>{$t("workspace.observe-page.took")}</TH></Tooltip>
                      <Tooltip label={$t("workspace.observe-page.whenItBeganCountedFromThe")}><TH>{$t("workspace.observe-page.started")}</TH></Tooltip>
                      <Tooltip label={$t("workspace.observe-page.countedFromTheMomentTheStep")}><TH>{$t("workspace.observe-page.doneBy")}</TH></Tooltip>
                    </tr>
                  </THead>
                  <TBody>
                    {o.startup.map((p) => (
                      <TR key={p.phase}>
                        <TD>
                          <span className="font-mono text-xs text-fg">{p.phase}</span>
                          {p.parallel > 0 && (
                            <Tooltip label={$t("workspace.observe-page.bootedAlongsideTheStepPodNot")}>
                              <span className="ms-2 text-xs text-fg-muted">
                                {$t("workspace.observe-page.inParallel2", { part: p.parallel < p.took.n ? $t("workspace.observe-page.onOf", { parallel: String(p.parallel), n: String(p.took.n) }) : "" })}
                              </span>
                            </Tooltip>
                          )}
                          {(p.waited.max ?? 0) > 0 && (
                            <Tooltip label={$t("workspace.observe-page.howLongItWasHeldFor")} side="bottom">
                              <span className="ms-2 text-xs text-fg-muted">
                                {$rich("workspace.observe-page.heldForServices", { spread: $el(<Spread s={p.waited} unit={fine} />) })}
                              </span>
                            </Tooltip>
                          )}
                        </TD>
                        <TD>
                          <Spread s={p.took} unit={fine} />
                        </TD>
                        <TD>
                          <Spread s={p.from} unit={fine} />
                        </TD>
                        <TD>
                          <Spread s={p.at} unit={fine} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Panel>
            )}

            {/* Flows: the shape of whole runs. */}
            <Panel title={$t("workspace.observe-page.flows")} flush>
              <Table className="min-w-[480px]">
                <THead>
                  <tr>
                    <TH>{$t("workspace.observe-page.flow")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.runs")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.failed")}</TH>
                    <TH>{$t("workspace.observe-page.duration")}</TH>
                    <TH className="text-end">{$t("workspace.observe-page.credits")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {o.flows.map((f) => (
                    <TR key={f.flow}>
                      <TD className="font-medium text-fg">{f.flow}</TD>
                      <TD className="text-end tabular-nums">{f.runs}</TD>
                      <TD className={`text-end tabular-nums ${f.failed ? "font-medium text-danger" : "text-fg-subtle"}`}>{f.failed || "—"}</TD>
                      <TD>
                        <Spread s={f.seconds} unit={secs} />
                      </TD>
                      <TD className="text-end tabular-nums text-fg">{usd(f.chargedUsd)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>

            {/* The last failures, in the step's own words, each linking to its
                run trace — this list is the "what just broke", the trace is
                the archive. */}
            {o.failures.length > 0 && (
              <Panel title={$t("workspace.observe-page.recentFailures")} flush>
                <PanelList>
                  {o.failures.slice(0, 12).map((f, i) => (
                    <li key={`${f.runId}-${i}`} className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium text-fg">{f.agent}</span>
                          <span className="text-fg-muted">{$t("workspace.observe-page.in", { flow: f.flow })}</span>
                          {f.attempts > 1 && <Chip tone="warn">{$t("workspace.observe-page.attempts", { attempts: String(f.attempts) })}</Chip>}
                        </span>
                        <Link href={runHref(f.runId)} className="shrink-0 text-[13px] tabular-nums text-fg-muted hover:text-fg hover:underline">
                          {f.at.slice(0, 16).replace("T", " ")}
                        </Link>
                      </div>
                      <p className="mt-1 line-clamp-2 font-mono text-xs text-fg-tertiary">{f.text}</p>
                    </li>
                  ))}
                </PanelList>
              </Panel>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
