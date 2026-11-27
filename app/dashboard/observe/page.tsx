// Observability for the whole account: is it the platform or my flows, which
// desk is getting worse, what did each day look like, what did it cost. Each
// workspace keeps its own Observe page for the step-by-step detail; this one
// is what you read first, and every row is a door to that detail.
//
// Everything is read from the runs themselves (no separate instrumentation):
// run outcomes through server/run-lite.ts, steps and tools through
// platform/observe.ts, shaped by components/account-observe-model.ts.

import { $t, localizedList } from "@/i18n";
import { cachedAccountInsights } from "@/server/insights";
import { creditsShort } from "@/components/money";
import Link from "@foldrun/ui/react/link";
import { viewerScope } from "@/server/users";
import { accountObservation } from "@/server/account-observe";
import { runHref } from "@/components/run-href";
import { fmtSpan } from "@/components/mission-model";
import { nowMs } from "@/components/overview-model";
import { type CauseRow, type DayBucket } from "@/components/account-observe-model";
import { ArrowDownRight, ArrowUpRight, ServerCrash } from "lucide-react";
import { Page, PageHeader, Panel, PanelLink, PanelList, Stat, StatGrid, Chip, Tag, type Tone, Callout } from "@foldrun/ui/react/page";
import { Table, THead, TBody, TR, TH, TD } from "@foldrun/ui/react/table";
import { ChartLegend } from "@foldrun/ui/react/chart";
import { Segmented } from "@foldrun/ui/react/segmented";
import { Tooltip } from "@foldrun/ui/react/tooltip";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

const WINDOWS = localizedList(() => [
  { days: 1, label: $t("observe.page.24Hours") },
  { days: 7, label: $t("observe.page.7Days") },
  { days: 30, label: $t("observe.page.30Days") },
]);

// Credits charged (FOL-54): the ledger's figure, list price for a run not
// settled yet — what the account pays, never token cost.
const money = (v: number) => creditsShort(v);
const pctOf = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const secs = (v: number | null) => (v === null ? "—" : fmtSpan(v * 1000));
const none = <span className="text-fg-subtle">—</span>;

/** A change against the previous window, coloured by whether it is good. */
const FMT = { pts: (v: number) => `${Math.round(v * 100)} pts`, money };

function Delta({ now, before, upIsGood, as }: { now: number | null; before: number | null; upIsGood: boolean; as: keyof typeof FMT }) {
  const fmt = FMT[as];
  if (now === null || before === null) return <span className="text-fg-subtle">{$t("observe.page.noEarlierWindowToCompare")}</span>;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span>{$t("observe.page.sameAsTheWindowBefore")}</span>;
  const good = d > 0 === upIsGood;
  const Arrow = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 font-medium ${good ? "text-success" : "text-danger"}`}>
        <Arrow className="size-3.5" aria-label={d > 0 ? $t("values.trend.up") : $t("values.trend.down")} />
        {fmt(Math.abs(d))}
      </span>
      {$t("observe.page.vsBefore")}
    </span>
  );
}

// The outcome series, in a fixed order from the baseline up. Status colours,
// always beside their label in the legend and the hover text, never alone.
const SERIES = localizedList(() => ([
  { key: "good", label: "succeeded", cls: "bg-emerald-500" },
  { key: "attention", label: "blocked / bad", cls: "bg-orange-400" },
  { key: "desk", label: $t("observe.page.failedDesk"), cls: "bg-red-500" },
  { key: "platform", label: $t("observe.page.failedPlatform"), cls: "bg-slate-700" },
] as const));

function OutcomeChart({ days, tz }: { days: DayBucket[]; tz: string }) {
  const max = Math.max(1, ...days.map((d) => d.good + d.attention + d.failed + d.other));
  const dense = days.length > 14;
  return (
    <div>
      <ChartLegend className="mb-4" items={SERIES.map((s) => ({ key: s.key, label: s.label, swatch: s.cls }))} aside={$t("observe.page.runsPerDay", { tz: String(tz) })} />
      <div className="flex h-44 items-end gap-1 border-b border-line">
        {days.map((d) => {
          const parts = { good: d.good, attention: d.attention, desk: d.failed - d.platform, platform: d.platform };
          const total = d.good + d.attention + d.failed + d.other;
          const title = $t("observe.page.runSucceededBlockedBadFailedDesk", { day: String(d.day), total: String(total), v2: total, good: String(d.good), attention: String(d.attention), v5: String(d.failed - d.platform), platform: String(d.platform), v7: String(money(d.spendUsd)) });
          return (
            <Tooltip key={d.day} label={title}>
              <div className="flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px] rounded-t hover:bg-sunken">
                {SERIES.map((s) =>
                  parts[s.key] > 0 ? <div key={s.key} className={`w-full rounded-[3px] ${s.cls}`} style={{ height: `${(parts[s.key] / max) * 100}%` }} /> : null,
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 text-xs tabular-nums text-fg-subtle">
        {days.map((d, i) => (
          <div key={d.day} className="min-w-0 flex-1 truncate text-center">
            {!dense || i % 5 === 0 || i === days.length - 1 ? d.day.slice(5).replace("-", "/") : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendChart({ days }: { days: DayBucket[] }) {
  const max = Math.max(0.01, ...days.map((d) => d.spendUsd));
  const peak = days.reduce((a, b) => (b.spendUsd > a.spendUsd ? b : a), days[0]);
  return (
    <div>
      <ChartLegend
        className="mb-4"
        items={[{ key: "spend", label: $t("observe.page.spendPerDay"), swatch: "bg-sky-500" }]}
        aside={peak && peak.spendUsd > 0 ? $t("observe.page.peakOn", { v0: String(money(peak.spendUsd)), v1: String(peak.day.slice(5).replace("-", "/")) }) : undefined}
      />
      <div className="flex h-36 items-end gap-1 border-b border-line">
        {days.map((d) => (
          <Tooltip key={d.day} label={`${d.day}: ${money(d.spendUsd)}`}>
            <div className="flex h-full min-w-0 flex-1 items-end hover:bg-sunken">
              {d.spendUsd > 0 && <div className="w-full rounded-t-[3px] bg-sky-500" style={{ height: `${(d.spendUsd / max) * 100}%` }} />}
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

/** Whose a cause is: the platform's, a person's (stopped), or the desk's. */
function causeOwner(c: CauseRow): { label: string; tone: Tone } {
  if (c.platform) return { label: "platform", tone: "info" };
  if (c.kind === "stopped") return { label: "person", tone: "default" };
  if (c.kind === "blocked" || c.kind === "bad") return { label: "desk", tone: "warn" };
  return { label: "desk", tone: "bad" };
}

export default async function AccountObservePage({ searchParams }: { searchParams: Promise<{ tenant?: string; days?: string }> }) {
  await requestLocale();
  const { tenant = "default", days: daysParam } = await searchParams;
  const days = WINDOWS.some((w) => String(w.days) === daysParam) ? Number(daysParam) : 7;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const now = nowMs();

  // A member scoped to some workspaces sees only those, here as everywhere.
  // The same analysis GET /v1/observe answers (`foldrun observe`).
  const scope = await viewerScope();
  const { timezone: tz, kpis: k, previous, daily, causes: why, desks, agents, tools } = await accountObservation(tenant, scope, days, now);
  // Recurring problems with their evidence and cost (FOL-72 step 8).
  const insights = cachedAccountInsights(tenant, scope, Math.min(days, 30), null, now);
  const platformRows = why.filter((c) => c.platform);
  const wrong = k.deskFailures + k.platformFailures;

  return (
    <Page width="wide">
      <PageHeader
        title={$t("observe.page.observe")}
        description={$t("observe.page.everyDeskInTheAccountOver", { label: String(WINDOWS.find((w) => w.days === days)!.label), days })}
        actions={<Segmented label={$t("observe.page.window")} value={String(days)} items={WINDOWS.map((w) => ({ key: String(w.days), label: w.label, href: `/dashboard/observe?days=${w.days}${amp}` }))} />}
      />

      <div className="space-y-8">
        {/* The one question first: is it the platform? */}
        {platformRows.length > 0 && (
          <Callout tone="info" className="px-4 py-3">
            <ServerCrash className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium text-fg">
                {$t("observe.page.runFailedBecauseOfThePlatform", { platformFailures: k.platformFailures })}
              </p>
              <ul className="space-y-0.5 text-fg-secondary">
                {platformRows.map((c) => (
                  <li key={c.key}>
                    <Link href={runHref(c.newest.workspace, c.newest.id, tenant)} className="font-medium hover:underline">
                      {c.label}
                    </Link>{" "}
                    <span className="text-fg-muted">
                      {$t("observe.page.runOnDeskLastAgo", { count: c.count, length: c.desks.length, fmtSpan: fmtSpan(now - Date.parse(c.newest.startedAt)) })}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">{$t("observe.page.noDeskEditFixesTheseOnce")}</p>
            </div>
          </Callout>
        )}

        <StatGrid className="xl:grid-cols-5">
          <Stat label={$t("observe.page.completed")} value={pctOf(k.rate)} tone={k.rate !== null && k.rate < 0.8 ? "danger" : undefined} sub={<Delta now={k.rate} before={k.prevRate} upIsGood as="pts" />} />
          <Stat label={$t("observe.page.runs")} value={k.runs} sub={$t("observe.page.finishedGoing", { finished: String(k.finished), v1: String(k.runs - k.finished) })} />
          <Stat label={$t("observe.page.wentWrong")} value={wrong} tone={wrong > 0 ? "danger" : "success"} sub={$t("observe.page.deskPlatform", { deskFailures: String(k.deskFailures), platformFailures: String(k.platformFailures) })} />
          <Stat label={$t("observe.page.charged")} value={money(k.spendUsd)} sub={<Delta now={k.spendUsd} before={previous.runs ? k.prevSpendUsd : null} upIsGood={false} as="money" />} />
          <Stat label={$t("observe.page.medianRun")} value={secs(k.medianSecs)} sub={k.medianSecs === null ? $t("observe.page.fewerThan5FinishedRuns") : "start to finish"} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel title={$t("observe.page.whatEachDayLookedLike")}>
            <OutcomeChart days={daily} tz={tz} />
          </Panel>
          <Panel title={$t("observe.page.cost")}>
            <SpendChart days={daily} />
            <div className="mt-3 flex justify-end">
              <PanelLink href={`/dashboard/usage${qs}`}>{$t("observe.page.usage")}</PanelLink>
            </div>
          </Panel>
        </div>

        {insights.length > 0 && (
          <Panel title={$t("observe.page.whatKeepsCostingYou")} count={insights.length} flush>
            <PanelList>
              {insights.slice(0, 8).map((i) => (
                <li key={i.id} className="space-y-1 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-fg">{i.title}</span>
                    <Tag>{i.workspace}</Tag>
                    <span className="ml-auto shrink-0 text-[13px] tabular-nums text-fg-muted">
                      {i.credits !== null && i.credits > 0 ? $t("observe.page.about", { v0: String(creditsShort(i.credits / 100)) }) : ""}
                      {$t("observe.page.step", { steps: i.steps })}
                    </span>
                  </div>
                  <p className="text-sm text-fg-muted">{i.why}</p>
                  <p className="text-sm text-fg">
                    <span className="text-fg-muted">{$t("observe.page.fix")}</span> {i.fix}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-xs">
                    {i.evidence.map((e) => (
                      <Link key={`${e.runId}/${e.step}`} href={runHref(e.workspace, e.runId, tenant)} className="font-mono text-fg-muted hover:text-fg hover:underline">
                        {$t("observe.page.step2", { runId: e.runId, step: String(e.step) })}
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </PanelList>
          </Panel>
        )}

        <Panel title={$t("observe.page.whyRunsWentWrong")} count={why.length} flush>
          {why.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-muted">{$t("observe.page.nothingWentWrongInThisWindow")}</p>
          ) : (
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>{$t("observe.page.cause")}</TH>
                  <TH className="text-right">{$t("observe.page.runs")}</TH>
                  <TH>{$t("observe.page.desks")}</TH>
                  <TH>{$t("observe.page.latestInItsOwnWords")}</TH>
                </tr>
              </THead>
              <TBody>
                {why.map((c) => {
                  const owner = causeOwner(c);
                  return (
                    <TR key={`${c.kind}:${c.key}`}>
                      <TD className="align-top">
                        <span className="flex min-w-0 items-center gap-2">
                          <Chip tone={owner.tone}>{owner.label}</Chip>
                          <span className="font-medium text-fg">{c.label}</span>
                        </span>
                      </TD>
                      <TD className="text-right align-top tabular-nums text-fg">{c.count}</TD>
                      <TD className="align-top">
                        <div className="flex max-w-[16rem] flex-wrap gap-1">
                          {c.desks.map((d) => (
                            <Link key={d} href={`/dashboard/${d}/observe${qs}`} className="hover:underline">
                              <Tag>{d}</Tag>
                            </Link>
                          ))}
                        </div>
                      </TD>
                      <TD className="max-w-[34rem] align-top">
                        <Tooltip label={c.sample ?? ""}>
                          <Link href={runHref(c.newest.workspace, c.newest.id, tenant)} className="line-clamp-2 text-fg-secondary hover:text-fg hover:underline">
                            {c.sample ?? "—"}
                          </Link>
                        </Tooltip>
                        <span className="text-xs text-fg-subtle">
                          {$t("observe.page.ago", { workspace: c.newest.workspace, fmtSpan: fmtSpan(now - Date.parse(c.newest.startedAt)) })}
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Panel>

        <Panel title={$t("observe.page.desksWorstFirst")} count={desks.length} flush>
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>{$t("observe.page.desk")}</TH>
                <TH className="text-right">{$t("observe.page.runs")}</TH>
                <Tooltip label={$t("observe.page.ranToTheEndWithoutFailing")}>
                  <TH className="text-right">{$t("observe.page.completed")}</TH>
                </Tooltip>
                <TH>{$t("observe.page.trend")}</TH>
                <TH className="text-right">{$t("observe.page.wentWrong")}</TH>
                <TH>{$t("observe.page.worstFlow")}</TH>
                <TH className="text-right">{$t("observe.page.medianRun")}</TH>
                <Tooltip label={$t("observe.page.creditsCharged")}>
                  <TH className="text-right">{$t("observe.page.credits")}</TH>
                </Tooltip>
              </tr>
            </THead>
            <TBody>
              {desks.map((d) => {
                const trend = d.rate !== null && d.prevRate !== null ? d.rate - d.prevRate : null;
                return (
                  <TR key={d.workspace} className={d.runs === 0 ? "text-fg-subtle" : ""}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/dashboard/${d.workspace}/observe${qs}`} className="font-medium text-fg hover:underline">
                        {d.workspace}
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums">{d.runs || "—"}</TD>
                    <TD className={`text-right tabular-nums ${d.rate === null ? "" : d.rate >= 0.8 ? "text-success" : d.rate >= 0.5 ? "text-warning" : "text-danger"}`}>{pctOf(d.rate)}</TD>
                    <TD className="whitespace-nowrap">
                      {trend === null ? (
                        none
                      ) : Math.abs(trend) < 0.005 ? (
                        <span className="text-fg-muted">{$t("observe.page.steady")}</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 ${trend > 0 ? "text-success" : "text-danger"}`}>
                          {trend > 0 ? <ArrowUpRight className="size-3.5" aria-label="up" /> : <ArrowDownRight className="size-3.5" aria-label="down" />}
                          {$t("observe.page.pts", { round: String(Math.round(Math.abs(trend) * 100)) })}
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {wrongOf(d) === 0 ? (
                        <span className="text-fg-subtle">0</span>
                      ) : (
                        <Link href={d.lastBad ? runHref(d.workspace, d.lastBad.id, tenant) : `/dashboard/${d.workspace}/runs${qs}`} className="hover:underline">
                          <span className="font-medium text-danger">{d.deskFailures}</span>
                          {d.platformFailures > 0 && <span className="text-fg-muted">{" "}{$t("observe.page.platform", { platformFailures: String(d.platformFailures) })}</span>}
                        </Link>
                      )}
                    </TD>
                    <TD>
                      {d.worst ? (
                        <span className="text-fg-secondary">
                          {d.worst.what} <span className="text-fg-subtle">×{d.worst.count}</span>
                        </span>
                      ) : (
                        none
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-fg-muted">{secs(d.medianSecs)}</TD>
                    <TD className="text-right tabular-nums text-fg-muted">{d.spendUsd ? money(d.spendUsd) : "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Panel>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <Panel title={$t("observe.page.agentsToWatch")} count={agents.length} flush>
            {agents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-muted">{$t("observe.page.noAgentRanInThisWindow")}</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>{$t("observe.page.agent")}</TH>
                    <TH className="text-right">{$t("observe.page.failed")}</TH>
                    <TH className="text-right">{$t("observe.page.retried")}</TH>
                    <TH className="text-right">p50</TH>
                    <Tooltip label={$t("observe.page.creditsCharged")}>
                      <TH className="text-right">{$t("observe.page.credits")}</TH>
                    </Tooltip>
                  </tr>
                </THead>
                <TBody>
                  {agents.map((a) => (
                    <TR key={`${a.workspace}/${a.agent}`}>
                      <TD>
                        <Link href={`/dashboard/${a.workspace}/observe${qs}`} className="font-medium text-fg hover:underline">
                          {a.agent}
                        </Link>
                        <span className="block text-xs text-fg-subtle">{a.workspace}</span>
                      </TD>
                      <TD className={`text-right tabular-nums ${a.failed ? "font-medium text-danger" : "text-fg-subtle"}`}>
                        {a.failed}
                        <span className="font-normal text-fg-subtle">/{a.steps}</span>
                      </TD>
                      <TD className={`text-right tabular-nums ${a.retried ? "text-warning" : "text-fg-subtle"}`}>{a.retried}</TD>
                      <TD className="text-right tabular-nums text-fg-muted">{secs(a.seconds.p50)}</TD>
                      <TD className="text-right tabular-nums text-fg-muted">{money(a.chargedUsd ?? 0)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
          <Panel title={$t("observe.page.tools")} count={tools.length} flush>
            {tools.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-muted">{$t("observe.page.noToolCallsInThisWindow")}</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>{$t("observe.page.tool")}</TH>
                    <TH className="text-right">{$t("observe.page.calls")}</TH>
                    <TH className="text-right">{$t("observe.page.errors")}</TH>
                    <TH className="text-right">{$t("observe.page.slowestP95")}</TH>
                    <TH>{$t("observe.page.usedBy")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {tools.map((t) => (
                    <TR key={t.name}>
                      <TD className="font-mono text-xs text-fg">{t.name}</TD>
                      <TD className="text-right tabular-nums">{t.calls}</TD>
                      <TD className={`whitespace-nowrap text-right tabular-nums ${t.errors ? "font-medium text-danger" : "text-fg-subtle"}`}>
                        {t.errors}
                        {t.errors > 0 && <span className="font-normal text-fg-subtle"> · {Math.round((t.errors / t.calls) * 100)}%</span>}
                      </TD>
                      <Tooltip label={$t("observe.page.onlyToolsThatTimeThemselvesReport")}>
                        <TD className="text-right tabular-nums text-fg-muted">
                          {t.p95ms === null ? "—" : t.p95ms >= 1000 ? `${(t.p95ms / 1000).toFixed(1)}s` : `${Math.round(t.p95ms)}ms`}
                        </TD>
                      </Tooltip>
                      <TD className="text-xs text-fg-muted">{t.workspaces.length === 1 ? t.workspaces[0] : `${t.workspaces.length} desks`}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
}

const wrongOf = (d: { deskFailures: number; platformFailures: number }) => d.deskFailures + d.platformFailures;
