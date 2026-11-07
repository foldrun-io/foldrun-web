// Observability for the whole account: is it the platform or my flows, which
// desk is getting worse, what did each day look like, what did it cost. Each
// workspace keeps its own Observe page for the step-by-step detail; this one
// is what you read first, and every row is a door to that detail.
//
// Everything is read from the runs themselves (no separate instrumentation):
// run outcomes through server/run-lite.ts, steps and tools through
// platform/observe.ts, shaped by components/account-observe-model.ts.

import { cachedAccountInsights } from "@/server/insights";
import { creditsShort } from "@/components/money";
import Link from "@/components/kit/link";
import { viewerScope } from "@/server/users";
import { accountObservation } from "@/server/account-observe";
import { runHref } from "@/components/run-href";
import { fmtSpan } from "@/components/mission-model";
import { nowMs } from "@/components/overview-model";
import { type CauseRow, type DayBucket } from "@/components/account-observe-model";
import { ArrowDownRight, ArrowUpRight, ServerCrash } from "lucide-react";
import { Page, PageHeader, Panel, PanelLink, PanelList, Stat, StatGrid, Chip, Tag, type Tone, Callout } from "@/components/kit/page";
import { Table, THead, TBody, TR, TH, TD } from "@/components/kit/table";
import { ChartLegend } from "@/components/kit/chart";
import { Segmented } from "@/components/kit/segmented";
import { Tooltip } from "@/components/kit/tooltip";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

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
  if (now === null || before === null) return <span className="text-fg-subtle">no earlier window to compare</span>;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span>same as the window before</span>;
  const good = d > 0 === upIsGood;
  const Arrow = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 font-medium ${good ? "text-success" : "text-danger"}`}>
        <Arrow className="size-3.5" aria-label={d > 0 ? "up" : "down"} />
        {fmt(Math.abs(d))}
      </span>
      vs before
    </span>
  );
}

// The outcome series, in a fixed order from the baseline up. Status colours,
// always beside their label in the legend and the hover text, never alone.
const SERIES = [
  { key: "good", label: "succeeded", cls: "bg-emerald-500" },
  { key: "attention", label: "blocked / bad", cls: "bg-orange-400" },
  { key: "desk", label: "failed — desk", cls: "bg-red-500" },
  { key: "platform", label: "failed — platform", cls: "bg-slate-700" },
] as const;

function OutcomeChart({ days, tz }: { days: DayBucket[]; tz: string }) {
  const max = Math.max(1, ...days.map((d) => d.good + d.attention + d.failed + d.other));
  const dense = days.length > 14;
  return (
    <div>
      <ChartLegend className="mb-4" items={SERIES.map((s) => ({ key: s.key, label: s.label, swatch: s.cls }))} aside={`runs per day · ${tz}`} />
      <div className="flex h-44 items-end gap-1 border-b border-line">
        {days.map((d) => {
          const parts = { good: d.good, attention: d.attention, desk: d.failed - d.platform, platform: d.platform };
          const total = d.good + d.attention + d.failed + d.other;
          const title = `${d.day}: ${total} run${total === 1 ? "" : "s"} — ${d.good} succeeded, ${d.attention} blocked/bad, ${d.failed - d.platform} failed (desk), ${d.platform} failed (platform) · ${money(d.spendUsd)}`;
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
        items={[{ key: "spend", label: "spend per day", swatch: "bg-sky-500" }]}
        aside={peak && peak.spendUsd > 0 ? `peak ${money(peak.spendUsd)} on ${peak.day.slice(5).replace("-", "/")}` : undefined}
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
  const { tenant = "default", days: daysParam } = await searchParams;
  const days = WINDOWS.some((w) => String(w.days) === daysParam) ? Number(daysParam) : 7;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const now = nowMs();

  // A member scoped to some workspaces sees only those, here as everywhere.
  // The same analysis GET /api/observe answers (`foldrun observe`).
  const scope = await viewerScope();
  const { timezone: tz, kpis: k, previous, daily, causes: why, desks, agents, tools } = await accountObservation(tenant, scope, days, now);
  // Recurring problems with their evidence and cost (FOL-72 step 8).
  const insights = cachedAccountInsights(tenant, scope, Math.min(days, 30), null, now);
  const platformRows = why.filter((c) => c.platform);
  const wrong = k.deskFailures + k.platformFailures;

  return (
    <Page width="wide">
      <PageHeader
        title="Observe"
        description={`Every desk in the account over the last ${WINDOWS.find((w) => w.days === days)!.label}, against the ${days === 1 ? "day" : `${days} days`} before.`}
        actions={<Segmented label="Window" value={String(days)} items={WINDOWS.map((w) => ({ key: String(w.days), label: w.label, href: `/dashboard/observe?days=${w.days}${amp}` }))} />}
      />

      <div className="space-y-8">
        {/* The one question first: is it the platform? */}
        {platformRows.length > 0 && (
          <Callout tone="info" className="px-4 py-3">
            <ServerCrash className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium text-fg">
                {k.platformFailures} run{k.platformFailures === 1 ? "" : "s"} failed because of the platform, not the desks
              </p>
              <ul className="space-y-0.5 text-fg-secondary">
                {platformRows.map((c) => (
                  <li key={c.key}>
                    <Link href={runHref(c.newest.workspace, c.newest.id, tenant)} className="font-medium hover:underline">
                      {c.label}
                    </Link>{" "}
                    <span className="text-fg-muted">
                      · {c.count} run{c.count === 1 ? "" : "s"} on {c.desks.length} desk{c.desks.length === 1 ? "" : "s"}, last {fmtSpan(now - Date.parse(c.newest.startedAt))} ago
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">No desk edit fixes these; once the platform is right, rerun them.</p>
            </div>
          </Callout>
        )}

        <StatGrid className="xl:grid-cols-5">
          <Stat label="Completed" value={pctOf(k.rate)} tone={k.rate !== null && k.rate < 0.8 ? "danger" : undefined} sub={<Delta now={k.rate} before={k.prevRate} upIsGood as="pts" />} />
          <Stat label="Runs" value={k.runs} sub={`${k.finished} finished · ${k.runs - k.finished} going`} />
          <Stat label="Went wrong" value={wrong} tone={wrong > 0 ? "danger" : "success"} sub={`${k.deskFailures} desk · ${k.platformFailures} platform`} />
          <Stat label="Charged" value={money(k.spendUsd)} sub={<Delta now={k.spendUsd} before={previous.runs ? k.prevSpendUsd : null} upIsGood={false} as="money" />} />
          <Stat label="Median run" value={secs(k.medianSecs)} sub={k.medianSecs === null ? "fewer than 5 finished runs" : "start to finish"} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel title="What each day looked like">
            <OutcomeChart days={daily} tz={tz} />
          </Panel>
          <Panel title="Cost">
            <SpendChart days={daily} />
            <div className="mt-3 flex justify-end">
              <PanelLink href={`/dashboard/usage${qs}`}>Usage</PanelLink>
            </div>
          </Panel>
        </div>

        {insights.length > 0 && (
          <Panel title="What keeps costing you" count={insights.length} flush>
            <PanelList>
              {insights.slice(0, 8).map((i) => (
                <li key={i.id} className="space-y-1 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-fg">{i.title}</span>
                    <Tag>{i.workspace}</Tag>
                    <span className="ml-auto shrink-0 text-[13px] tabular-nums text-fg-muted">
                      {i.credits !== null && i.credits > 0 ? `about ${creditsShort(i.credits / 100)} · ` : ""}
                      {i.steps} step{i.steps === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-sm text-fg-muted">{i.why}</p>
                  <p className="text-sm text-fg">
                    <span className="text-fg-muted">Fix:</span> {i.fix}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-xs">
                    {i.evidence.map((e) => (
                      <Link key={`${e.runId}/${e.step}`} href={runHref(e.workspace, e.runId, tenant)} className="font-mono text-fg-muted hover:text-fg hover:underline">
                        {e.runId} · step {e.step}
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </PanelList>
          </Panel>
        )}

        <Panel title="Why runs went wrong" count={why.length} flush>
          {why.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-muted">Nothing went wrong in this window.</p>
          ) : (
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>Cause</TH>
                  <TH className="text-right">Runs</TH>
                  <TH>Desks</TH>
                  <TH>Latest, in its own words</TH>
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
                          {c.newest.workspace} · {fmtSpan(now - Date.parse(c.newest.startedAt))} ago
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Panel>

        <Panel title="Desks, worst first" count={desks.length} flush>
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>Desk</TH>
                <TH className="text-right">Runs</TH>
                <Tooltip label="Ran to the end without failing, of completed + failed runs (stopped left out)">
                  <TH className="text-right">Completed</TH>
                </Tooltip>
                <TH>Trend</TH>
                <TH className="text-right">Went wrong</TH>
                <TH>Worst flow</TH>
                <TH className="text-right">Median run</TH>
                <Tooltip label="Credits charged">
                  <TH className="text-right">Credits</TH>
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
                        <span className="text-fg-muted">steady</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 ${trend > 0 ? "text-success" : "text-danger"}`}>
                          {trend > 0 ? <ArrowUpRight className="size-3.5" aria-label="up" /> : <ArrowDownRight className="size-3.5" aria-label="down" />}
                          {Math.round(Math.abs(trend) * 100)} pts
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {wrongOf(d) === 0 ? (
                        <span className="text-fg-subtle">0</span>
                      ) : (
                        <Link href={d.lastBad ? runHref(d.workspace, d.lastBad.id, tenant) : `/dashboard/${d.workspace}/runs${qs}`} className="hover:underline">
                          <span className="font-medium text-danger">{d.deskFailures}</span>
                          {d.platformFailures > 0 && <span className="text-fg-muted"> +{d.platformFailures} platform</span>}
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
          <Panel title="Agents to watch" count={agents.length} flush>
            {agents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-muted">No agent ran in this window.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Agent</TH>
                    <TH className="text-right">Failed</TH>
                    <TH className="text-right">Retried</TH>
                    <TH className="text-right">p50</TH>
                    <Tooltip label="Credits charged">
                      <TH className="text-right">Credits</TH>
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
          <Panel title="Tools" count={tools.length} flush>
            {tools.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-muted">No tool calls in this window.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Tool</TH>
                    <TH className="text-right">Calls</TH>
                    <TH className="text-right">Errors</TH>
                    <TH className="text-right">Slowest p95</TH>
                    <TH>Used by</TH>
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
                      <Tooltip label="Only tools that time themselves report a latency">
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
