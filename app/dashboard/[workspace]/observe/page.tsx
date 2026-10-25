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
import { WorkspaceHeader } from "@/components/workspace-header";
import { Card, EmptyScreen, PageHeader, StatCard } from "@/components/ui";

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
const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);
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

const TH = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-fg-subtle";
const TD = "px-3 py-2 text-sm";

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Observe"
        subtitle={`What the agents in ${workspace} actually did — failures, retries, tool health and cost, from the run records themselves.`}
      >
        <Link
          href={`/api/workspaces/${workspace}/observe?since=${sinceDays}`}
          className="text-sm font-medium text-fg-muted hover:text-fg"
        >
          As JSON →
        </Link>
      </PageHeader>

      {/* The window, stated and switchable. Every number below describes it. */}
      <div className="mb-4 flex items-center gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.days}
            href={`/dashboard/${workspace}/observe?since=${w.days}${tenantParam}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              w.days === sinceDays
                ? "border-gray-900 bg-ink text-on-ink"
                : "border-line bg-surface text-fg-tertiary hover:border-line-strong"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {/* The thing no proxy-shaped observability tool can do: quality,
          attributed to the commit that changed it. Every eval run is stamped
          with the commit the workspace was running; a drop names the change.
          Compared against the previous DIFFERENT commit, not the previous
          run — two runs on one commit differ only by the model's mood. */}
      {trends.length > 0 && (
        <Card className="mb-6 overflow-x-auto">
          <p className="border-b border-line-faint px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Evals by change
          </p>
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-line-faint">
                <th className={TH}>Eval</th>
                <th className={TH}>Now</th>
                <th className={TH}>At</th>
                <th className={TH}>Before</th>
                <th className={TH}>Change</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((t) => {
                const total = t.latest.passed + t.latest.failed;
                const dropped = t.delta !== null && t.delta < 0;
                const improved = t.delta !== null && t.delta > 0;
                return (
                  <tr key={t.eval} className="border-b border-gray-50 last:border-0">
                    <td className={`${TD} font-medium text-fg`}>
                      <Link href={`/dashboard/${workspace}/evals${qs}`} className="hover:underline">
                        {t.eval}
                      </Link>
                    </td>
                    <td className={`${TD} ${dropped ? "font-medium text-red-600" : "text-fg"}`}>
                      {t.latest.passed}/{total}
                    </td>
                    <td className={`${TD} font-mono text-xs text-fg-muted`}>
                      {t.latest.commit ? (
                        // A git sha when the workspace deploys from git; a
                        // revision id (r-…) when it was edited here. Either
                        // names the change — History on the file shows it.
                        t.latest.commit.startsWith("r-") ? t.latest.commit.slice(0, 12) : t.latest.commit.slice(0, 7)
                      ) : (
                        <span className="text-gray-300">no change on record</span>
                      )}
                    </td>
                    <td className={`${TD} text-fg-muted`}>
                      {t.previous ? (
                        <>
                          {t.previous.passed}/{t.previous.passed + t.previous.failed}
                          <span className="ml-1.5 font-mono text-xs text-fg-subtle">
                            {t.previous.commit ? (t.previous.commit.startsWith("r-") ? t.previous.commit.slice(0, 12) : t.previous.commit.slice(0, 7)) : "—"}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-300">first commit with a run</span>
                      )}
                    </td>
                    <td className={TD}>
                      {t.delta === null ? (
                        <span className="text-gray-300">—</span>
                      ) : dropped ? (
                        <span className="font-medium text-red-600">{t.delta} — this change made it worse</span>
                      ) : improved ? (
                        <span className="font-medium text-green-700">+{t.delta}</span>
                      ) : (
                        <span className="text-fg-subtle">unchanged</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {o.runs === 0 ? (
        <EmptyScreen
          title="Nothing ran in this window"
          description="Widen the window above, or start a run — this page fills itself from the run records."
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Runs" value={o.runs} />
            <StatCard
              label="Failed runs"
              value={o.failedRuns}
              tone={o.failedRuns > 0 ? "error" : undefined}
            />
            <StatCard label="Steps" value={o.steps} />
            <StatCard label="Charged" value={usd(o.chargedUsd)} />
            <StatCard
              label="Completed"
              value={o.tally.completedPct === null ? "—" : `${o.tally.completedPct}%`}
            />
          </div>

          {/* Day by day: volume with failures burned in. A bar is a link to
              nothing — the table of failures below is where names live. */}
          <Card className="mb-6 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">By day</p>
            <div className="flex h-16 items-end gap-[2px]">
              {o.days.map((d) => {
                const h = Math.max(6, Math.round((d.runs / maxDayRuns) * 56));
                const failH = d.runs ? Math.round((d.failed / d.runs) * h) : 0;
                return (
                  <div
                    key={d.day}
                    className="flex flex-1 flex-col justify-end"
                    title={`${d.day}: ${d.runs} run${d.runs === 1 ? "" : "s"}, ${d.failed} failed, ${usd(d.chargedUsd)}`}
                  >
                    {failH > 0 && <div className="w-full rounded-t-sm bg-red-400" style={{ height: failH }} />}
                    <div
                      className={`w-full bg-gray-300 ${failH > 0 ? "" : "rounded-t-sm"}`}
                      style={{ height: h - failH }}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Agents: the who. Sorted by cost because "which agent burns the
              most" is the first question, but failures and retries are the
              columns this page exists for. */}
          <Card className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-line-faint">
                  <th className={TH}>Agent</th>
                  <th className={TH}>Steps</th>
                  <th className={TH}>Failed</th>
                  <th className={TH}>Retried</th>
                  <th className={TH}>Skipped</th>
                  <th className={TH}>Step time</th>
                  <th className={TH} title="model turns per step — the agent's whole context is sent again on each">Turns</th>
                  <th className={TH}>Tokens in / out</th>
                  <th className={TH}>Cached</th>
                  <th className={TH}>Credits</th>
                </tr>
              </thead>
              <tbody>
                {o.agents.map((a) => (
                  <tr key={a.agent} className="border-b border-gray-50 last:border-0">
                    <td className={`${TD} font-medium text-fg`}>
                      <Link href={`/dashboard/${workspace}/agents${qs}`} className="hover:underline">
                        {a.agent}
                      </Link>
                    </td>
                    <td className={TD}>{a.steps}</td>
                    <td className={`${TD} ${a.failed ? "font-medium text-red-600" : "text-fg-subtle"}`}>
                      {a.failed || "—"}
                    </td>
                    <td className={`${TD} ${a.retried ? "font-medium text-amber-600" : "text-fg-subtle"}`}>
                      {a.retried || "—"}
                    </td>
                    <td className={`${TD} text-fg-muted`}>{a.skipped || "—"}</td>
                    <td className={TD}>
                      <Spread s={a.seconds} unit={secs} />
                    </td>
                    <td className={TD} title={a.systemPromptChars?.max != null ? `system prompt ${chars(a.systemPromptChars.max)} characters, sent on every turn` : undefined}>
                      {a.turns ? <Spread s={a.turns} unit={count} /> : <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className={`${TD} text-fg-muted`}>
                      {num(a.inputTokens)} / {num(a.outputTokens)}
                    </td>
                    <td
                      className={`${TD} text-fg-muted`}
                      title={a.cacheHitRate == null ? "no step reports cache reads yet" : `${num(a.cacheReadTokens)} input tokens read from the prompt cache`}
                    >
                      {a.cacheHitRate == null ? "—" : `${Math.round(a.cacheHitRate * 100)}%`}
                    </td>
                    <td className={TD}>{usd(a.chargedUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Tools: the what-with. Latency only where the tool measured its
              own; a built-in shows calls and an em dash, deliberately. */}
          {o.tools.length > 0 && (
            <Card className="mb-6 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-line-faint">
                    <th className={TH}>Tool</th>
                    <th className={TH}>Calls</th>
                    <th className={TH}>Errors</th>
                    <th className={TH}>Latency</th>
                    <th className={TH} title="characters each result put into the conversation — sent again on every later turn">Result size</th>
                    <th className={TH}>Called by</th>
                  </tr>
                </thead>
                <tbody>
                  {o.tools.map((t) => (
                    <tr key={t.name} className="border-b border-gray-50 last:border-0">
                      <td className={`${TD} font-mono text-xs text-fg`}>{t.name}</td>
                      <td className={TD}>{t.calls}</td>
                      <td className={`${TD} ${t.errors ? "font-medium text-red-600" : "text-fg-subtle"}`}>
                        {t.errors || "—"}
                      </td>
                      <td className={TD}>
                        {t.measured === 0 ? (
                          <span className="text-fg-subtle" title="this tool does not report its own duration; the gap to the next event includes model thinking, so no latency is invented for it">
                            —
                          </span>
                        ) : (
                          <Spread s={t.ms} unit={ms} />
                        )}
                      </td>
                      <td
                        className={TD}
                        title={t.resultSize && t.resultSize.n > 0 ? `${num(t.resultChars)} characters over ${t.resultSize.n} results; ${t.heavyCalls} over 10k` : "no result sizes recorded yet (from 18 Oct 2026)"}
                      >
                        {t.resultSize && t.resultSize.n > 0 ? (
                          <>
                            <Spread s={t.resultSize} unit={chars} />
                            {t.heavyCalls > 0 && <span className="ml-1 text-xs font-medium text-amber-600">{t.heavyCalls} heavy</span>}
                          </>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className={`${TD} text-xs text-fg-muted`}>{t.agents.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Start-up: where a step's first seconds go before the model
              speaks, phase by phase (FOL-29). Each phase's own share, and
              when it ended counted from the step's start. */}
          {o.startup.length > 0 && (
            <Card className="mb-6 overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="border-b border-line-faint">
                    <th className={TH} title="in the order a step goes through them">Start-up phase</th>
                    <th className={TH} title="this phase's own share: the gap since the phase before it">Took</th>
                    <th className={TH} title="counted from the moment the step started">Done by</th>
                  </tr>
                </thead>
                <tbody>
                  {o.startup.map((p) => (
                    <tr key={p.phase} className="border-b border-gray-50 last:border-0">
                      <td className={`${TD} font-mono text-xs text-fg`}>{p.phase}</td>
                      <td className={TD}>
                        <Spread s={p.took} unit={fine} />
                      </td>
                      <td className={TD}>
                        <Spread s={p.at} unit={fine} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Flows: the shape of whole runs. */}
          <Card className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-line-faint">
                  <th className={TH}>Flow</th>
                  <th className={TH}>Runs</th>
                  <th className={TH}>Failed</th>
                  <th className={TH}>Duration</th>
                  <th className={TH}>Credits</th>
                </tr>
              </thead>
              <tbody>
                {o.flows.map((f) => (
                  <tr key={f.flow} className="border-b border-gray-50 last:border-0">
                    <td className={`${TD} font-medium text-fg`}>{f.flow}</td>
                    <td className={TD}>{f.runs}</td>
                    <td className={`${TD} ${f.failed ? "font-medium text-red-600" : "text-fg-subtle"}`}>
                      {f.failed || "—"}
                    </td>
                    <td className={TD}>
                      <Spread s={f.seconds} unit={secs} />
                    </td>
                    <td className={TD}>{usd(f.chargedUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* The last failures, in the step's own words, each linking to its
              run trace — this list is the "what just broke", the trace is
              the archive. */}
          {o.failures.length > 0 && (
            <Card className="overflow-hidden">
              <p className="border-b border-line-faint px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Recent failures
              </p>
              <ul>
                {o.failures.slice(0, 12).map((f, i) => (
                  <li key={`${f.runId}-${i}`} className="border-b border-gray-50 px-4 py-3 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-fg">
                        {f.agent}
                        <span className="font-normal text-fg-subtle"> in {f.flow}</span>
                        {f.attempts > 1 && (
                          <span className="font-normal text-amber-600"> · {f.attempts} attempts</span>
                        )}
                      </span>
                      <Link href={runHref(f.runId)} className="shrink-0 text-xs font-medium text-fg-muted hover:text-fg">
                        {f.at.slice(0, 16).replace("T", " ")} →
                      </Link>
                    </div>
                    <p className="mt-1 line-clamp-2 font-mono text-xs text-fg-tertiary">{f.text}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
