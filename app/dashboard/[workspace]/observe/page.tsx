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

import { creditsShort } from "@/components/money";
import { runCharges } from "@/server/run-charges";
import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { observeWorkspace, type Sampled } from "@/platform/observe";
import { evalTrends } from "@/lib/evals";
import { Activity, Braces } from "lucide-react";
import { Page, PageHeader, Panel, PanelList, Stat, StatGrid, EmptyState, Chip } from "@/components/kit/page";
import { Table, THead, TBody, TR, TH, TD } from "@/components/kit/table";
import { buttonVariants } from "@/components/kit/button";
import { Segmented, ChartLegend } from "@/components/kit/inspect-extra";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

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
      <span className="text-fg-tertiary" title={`${s.n} sample${s.n === 1 ? "" : "s"} — too few for percentiles`}>
        ≤{unit(s.max)} <span className="text-fg-subtle">(n={s.n})</span>
      </span>
    );
  }
  return (
    <span className="text-fg-tertiary" title={`over ${s.n} samples`}>
      {unit(s.p50)} <span className="text-fg-subtle">/ p95 {unit(s.p95)}</span>
    </span>
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
        title="Observe"
        description="What the agents here actually did: failures, retries, tool health and cost, read from the run records."
        actions={
          <>
            {/* The window, stated and switchable. Every number below describes it. */}
            <Segmented
              label="Window"
              value={String(sinceDays)}
              items={WINDOWS.map((w) => ({ key: String(w.days), label: w.label, href: `/dashboard/${workspace}/observe?since=${w.days}${tenantParam}` }))}
            />
            <Link href={`/api/workspaces/${workspace}/observe?since=${sinceDays}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
              <Braces aria-hidden />
              JSON
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
          <Panel title="Evals by change" description="Each eval's latest score against the last different commit." flush>
            <Table className="min-w-[560px]">
              <THead>
                <tr>
                  <TH>Eval</TH>
                  <TH>Now</TH>
                  <TH>At</TH>
                  <TH>Before</TH>
                  <TH>Change</TH>
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
                        {t.latest.commit ? shortRev(t.latest.commit) : <span className="font-sans text-fg-subtle">no change on record</span>}
                      </TD>
                      <TD className="text-fg-muted">
                        {t.previous ? (
                          <>
                            {t.previous.passed}/{t.previous.passed + t.previous.failed}
                            <span className="ml-1.5 font-mono text-xs text-fg-subtle">{t.previous.commit ? shortRev(t.previous.commit) : "—"}</span>
                          </>
                        ) : (
                          <span className="text-fg-subtle">first commit with a run</span>
                        )}
                      </TD>
                      <TD>
                        {t.delta === null ? (
                          dash
                        ) : dropped ? (
                          <Chip tone="bad">{t.delta} — this change made it worse</Chip>
                        ) : improved ? (
                          <Chip tone="good">+{t.delta}</Chip>
                        ) : (
                          <span className="text-fg-subtle">unchanged</span>
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
            title="Nothing ran in this window"
            description="Widen the window, or start a run: this page fills itself from the run records."
          />
        ) : (
          <>
            <StatGrid className="xl:grid-cols-5">
              <Stat label="Runs" value={o.runs} sub={`in ${windowLabel}`} />
              <Stat label="Failed runs" value={o.failedRuns} tone={o.failedRuns > 0 ? "danger" : undefined} />
              <Stat label="Steps" value={o.steps} />
              <Stat label="Charged" value={usd(o.chargedUsd)} />
              <Stat label="Completed" value={o.tally.completedPct === null ? "—" : `${o.tally.completedPct}%`} />
            </StatGrid>

            {/* Day by day: volume with failures burned in. A bar is a link to
                nothing — the table of failures below is where names live. */}
            <Panel title="Runs by day">
              <ChartLegend
                className="mb-4"
                items={[
                  { key: "runs", label: "runs", swatch: "bg-muted-strong" },
                  { key: "failed", label: "failed", swatch: "bg-danger" },
                ]}
                aside={`busiest day ${maxDayRuns} run${maxDayRuns === 1 ? "" : "s"}`}
              />
              <div className="flex h-28 items-end gap-[2px] border-b border-line">
                {o.days.map((d) => {
                  const h = Math.max(4, Math.round((d.runs / maxDayRuns) * 100));
                  const failH = d.runs ? (d.failed / d.runs) * h : 0;
                  return (
                    <div
                      key={d.day}
                      className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-sm hover:bg-sunken"
                      title={`${d.day}: ${d.runs} run${d.runs === 1 ? "" : "s"}, ${d.failed} failed, ${usd(d.chargedUsd)}`}
                    >
                      {failH > 0 && <div className="w-full rounded-t-sm bg-danger" style={{ height: `${failH}%` }} />}
                      <div className={`w-full bg-muted-strong ${failH > 0 ? "" : "rounded-t-sm"}`} style={{ height: `${h - failH}%` }} />
                    </div>
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
            <Panel title="Agents" description="Sorted by credits. Percentiles appear once there are enough samples." flush>
              <Table className="min-w-[760px]">
                <THead>
                  <tr>
                    <TH>Agent</TH>
                    <TH className="text-right">Steps</TH>
                    <TH className="text-right">Failed</TH>
                    <TH className="text-right">Retried</TH>
                    <TH className="text-right">Skipped</TH>
                    <TH>Step time</TH>
                    <TH title="model turns per step — the agent's whole context is sent again on each">Turns</TH>
                    <TH>Tokens in / out</TH>
                    <TH className="text-right">Cached</TH>
                    <TH className="text-right">Credits</TH>
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
                      <TD className="text-right tabular-nums">{a.steps}</TD>
                      <TD className={`text-right tabular-nums ${a.failed ? "font-medium text-danger" : "text-fg-subtle"}`}>{a.failed || "—"}</TD>
                      <TD className={`text-right tabular-nums ${a.retried ? "font-medium text-warning" : "text-fg-subtle"}`}>{a.retried || "—"}</TD>
                      <TD className="text-right tabular-nums text-fg-muted">{a.skipped || "—"}</TD>
                      <TD>
                        <Spread s={a.seconds} unit={secs} />
                      </TD>
                      <TD title={a.systemPromptChars?.max != null ? `system prompt ${chars(a.systemPromptChars.max)} characters, sent on every turn` : undefined}>
                        {a.turns ? <Spread s={a.turns} unit={count} /> : dash}
                      </TD>
                      <TD className="tabular-nums text-fg-muted">
                        {num(a.inputTokens)} / {num(a.outputTokens)}
                      </TD>
                      <TD
                        className="text-right tabular-nums text-fg-muted"
                        title={a.cacheHitRate == null ? "no step reports cache reads yet" : `${num(a.cacheReadTokens)} input tokens read from the prompt cache`}
                      >
                        {a.cacheHitRate == null ? "—" : `${Math.round(a.cacheHitRate * 100)}%`}
                      </TD>
                      <TD className="text-right tabular-nums text-fg">{usd(a.chargedUsd)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>

            {/* Tools: the what-with. Latency only where the tool measured its
                own; a built-in shows calls and an em dash, deliberately. */}
            {o.tools.length > 0 && (
              <Panel title="Tools" description="Latency only where a tool times itself." flush>
                <Table className="min-w-[640px]">
                  <THead>
                    <tr>
                      <TH>Tool</TH>
                      <TH className="text-right">Calls</TH>
                      <TH className="text-right">Errors</TH>
                      <TH>Latency</TH>
                      <TH title="characters each result put into the conversation — sent again on every later turn">Result size</TH>
                      <TH>Called by</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {o.tools.map((t) => (
                      <TR key={t.name}>
                        <TD className="font-mono text-xs text-fg">{t.name}</TD>
                        <TD className="text-right tabular-nums">{t.calls}</TD>
                        <TD className={`text-right tabular-nums ${t.errors ? "font-medium text-danger" : "text-fg-subtle"}`}>{t.errors || "—"}</TD>
                        <TD>
                          {t.measured === 0 ? (
                            <span className="text-fg-subtle" title="this tool does not report its own duration; the gap to the next event includes model thinking, so no latency is invented for it">
                              —
                            </span>
                          ) : (
                            <Spread s={t.ms} unit={ms} />
                          )}
                        </TD>
                        <TD title={t.resultSize && t.resultSize.n > 0 ? `${num(t.resultChars)} characters over ${t.resultSize.n} results; ${t.heavyCalls} over 10k` : "no result sizes recorded yet (from 18 Oct 2026)"}>
                          {t.resultSize && t.resultSize.n > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Spread s={t.resultSize} unit={chars} />
                              {t.heavyCalls > 0 && <Chip tone="warn">{t.heavyCalls} heavy</Chip>}
                            </span>
                          ) : (
                            dash
                          )}
                        </TD>
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
              <Panel title="Start-up" description="Where a step's first seconds go, counted from the moment it started." flush>
                <Table className="min-w-[560px]">
                  <THead>
                    <tr>
                      <TH title="in the order a step goes through them">Phase</TH>
                      <TH title="this phase's own share: from when it could begin to when it ended">Took</TH>
                      <TH title="when it began, counted from the moment the step started — the services pods boot alongside the step pod, from 0">Started</TH>
                      <TH title="counted from the moment the step started">Done by</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {o.startup.map((p) => (
                      <TR key={p.phase}>
                        <TD>
                          <span className="font-mono text-xs text-fg">{p.phase}</span>
                          {p.parallel > 0 && (
                            <span className="ml-2 text-xs text-fg-muted" title="booted alongside the step pod, not before it">
                              in parallel{p.parallel < p.took.n ? ` on ${p.parallel} of ${p.took.n}` : ""}
                            </span>
                          )}
                          {(p.waited.max ?? 0) > 0 && (
                            <span className="ml-2 text-xs text-fg-muted" title="how long it was held for the services pods, before its own share">
                              held for services <Spread s={p.waited} unit={fine} />
                            </span>
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
            <Panel title="Flows" flush>
              <Table className="min-w-[480px]">
                <THead>
                  <tr>
                    <TH>Flow</TH>
                    <TH className="text-right">Runs</TH>
                    <TH className="text-right">Failed</TH>
                    <TH>Duration</TH>
                    <TH className="text-right">Credits</TH>
                  </tr>
                </THead>
                <TBody>
                  {o.flows.map((f) => (
                    <TR key={f.flow}>
                      <TD className="font-medium text-fg">{f.flow}</TD>
                      <TD className="text-right tabular-nums">{f.runs}</TD>
                      <TD className={`text-right tabular-nums ${f.failed ? "font-medium text-danger" : "text-fg-subtle"}`}>{f.failed || "—"}</TD>
                      <TD>
                        <Spread s={f.seconds} unit={secs} />
                      </TD>
                      <TD className="text-right tabular-nums text-fg">{usd(f.chargedUsd)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>

            {/* The last failures, in the step's own words, each linking to its
                run trace — this list is the "what just broke", the trace is
                the archive. */}
            {o.failures.length > 0 && (
              <Panel title="Recent failures" flush>
                <PanelList>
                  {o.failures.slice(0, 12).map((f, i) => (
                    <li key={`${f.runId}-${i}`} className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium text-fg">{f.agent}</span>
                          <span className="text-fg-muted">in {f.flow}</span>
                          {f.attempts > 1 && <Chip tone="warn">{f.attempts} attempts</Chip>}
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
