// Observability for the whole account: is it the platform or my flows, which
// desk is getting worse, what did each day look like, what did it cost. Each
// workspace keeps its own Observe page for the step-by-step detail; this one
// is what you read first, and every row is a door to that detail.
//
// Everything is read from the runs themselves (no separate instrumentation):
// run outcomes through server/run-lite.ts, steps and tools through
// platform/observe.ts, shaped by components/account-observe-model.ts.

import { accountInsights } from "@/server/insights";
import { creditsShort } from "@/components/money";
import Link from "next/link";
import { viewerScope } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { listAllRuns, listFlows, listWorkspaces } from "@/lib/store";
import { observeWorkspace } from "@/platform/observe";
import { runLite } from "@/server/run-lite";
import { runCharges } from "@/server/run-charges";
import { runHref } from "@/components/run-href";
import { OUTCOME } from "@/components/outcome-model";
import { fmtSpan } from "@/components/mission-model";
import { PageHeader } from "@/components/ui";
import { Panel } from "@/components/mission-control";
import { nowMs } from "@/components/overview-model";
import {
  accountTimezone,
  agentsToWatch,
  causes,
  deskHealth,
  kpis,
  perDay,
  toolsAcross,
  windows,
  type CauseRow,
  type DayBucket,
} from "@/components/account-observe-model";

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
const TH = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-fg-subtle";
const TD = "px-3 py-2 align-top";

/** A change against the previous window, coloured by whether it is good. */
const FMT = { pts: (v: number) => `${Math.round(v * 100)} pts`, money };

function Delta({ now, before, upIsGood, as }: { now: number | null; before: number | null; upIsGood: boolean; as: keyof typeof FMT }) {
  const fmt = FMT[as];
  if (now === null || before === null) return <span className="text-xs text-fg-subtle">no earlier window to compare</span>;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span className="text-xs text-fg-muted">same as the window before</span>;
  const good = d > 0 === upIsGood;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-700" : "text-red-700"}`}>
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))} <span className="font-normal text-fg-muted">vs the window before</span>
    </span>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 font-cal text-2xl font-semibold tabular-nums tracking-tight ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-fg"}`}>{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
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
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-tertiary">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-fg-subtle">runs per day · {tz}</span>
      </div>
      <div className="flex h-40 items-end gap-1 border-b border-line">
        {days.map((d) => {
          const parts = { good: d.good, attention: d.attention, desk: d.failed - d.platform, platform: d.platform };
          const total = d.good + d.attention + d.failed + d.other;
          const title = `${d.day}: ${total} run${total === 1 ? "" : "s"} — ${d.good} succeeded, ${d.attention} blocked/bad, ${d.failed - d.platform} failed (desk), ${d.platform} failed (platform) · ${money(d.spendUsd)}`;
          return (
            <div key={d.day} title={title} className="group flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px] rounded-t hover:bg-sunken">
              {SERIES.map((s) =>
                parts[s.key] > 0 ? (
                  <div key={s.key} className={`w-full rounded-[3px] ${s.cls}`} style={{ height: `${(parts[s.key] / max) * 100}%` }} />
                ) : null,
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] tabular-nums text-fg-subtle">
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
      <div className="mb-3 flex items-center text-[11px] text-fg-muted">
        spend per day
        {peak && peak.spendUsd > 0 && <span className="ml-auto text-fg-subtle">peak {money(peak.spendUsd)} on {peak.day.slice(5).replace("-", "/")}</span>}
      </div>
      <div className="flex h-24 items-end gap-1 border-b border-line">
        {days.map((d) => (
          <div key={d.day} title={`${d.day}: ${money(d.spendUsd)}`} className="flex h-full min-w-0 flex-1 items-end hover:bg-sunken">
            {d.spendUsd > 0 && <div className="w-full rounded-t-[3px] bg-sky-500" style={{ height: `${(d.spendUsd / max) * 100}%` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

const CAUSE_TONE: Record<CauseRow["kind"], string> = {
  platform: "bg-slate-800 text-white ring-slate-800",
  verify: "bg-red-50 text-red-700 ring-red-200",
  timeout: "bg-red-50 text-red-700 ring-red-200",
  error: "bg-red-50 text-red-700 ring-red-200",
  blocked: OUTCOME.blocked.pill,
  bad: OUTCOME.bad.pill,
  stopped: OUTCOME.stopped.pill,
};

export default async function AccountObservePage({ searchParams }: { searchParams: Promise<{ tenant?: string; days?: string }> }) {
  const { tenant = "default", days: daysParam } = await searchParams;
  const days = WINDOWS.some((w) => String(w.days) === daysParam) ? Number(daysParam) : 7;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const now = nowMs();

  // A member scoped to some workspaces sees only those, here as everywhere.
  const scope = await viewerScope();
  const workspaces = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map((w) => w.name);
  const charges = await runCharges(tenant);
  const lite = listAllRuns(tenant)
    .filter((r) => scopeAllows(scope, r.workspace))
    .map((r) => runLite(r, charges));

  const tz = accountTimezone(
    workspaces.flatMap((w) => {
      try {
        return listFlows(tenant, w).map((f) => f.timezone);
      } catch {
        return [];
      }
    }),
  );
  const { cur, prev } = windows(lite, now, days);
  const k = kpis(cur, prev);
  const daily = perDay(cur, now, Math.max(days, 7), tz);
  const why = causes(cur);
  const desks = deskHealth(workspaces, cur, prev);
  const per = workspaces.map((w) => observeWorkspace(tenant, w, days, undefined, charges));
  // Recurring problems with their evidence and cost (FOL-72 step 8).
  const insights = accountInsights(tenant, scope, Math.min(days, 30), null, now);
  const agents = agentsToWatch(per, 10);
  const tools = toolsAcross(per, 10);
  const platformRows = why.filter((c) => c.platform);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <PageHeader
        title="Observe"
        subtitle={`Every desk in the account, over the last ${WINDOWS.find((w) => w.days === days)!.label}, compared with the ${days === 1 ? "day" : `${days} days`} before.`}
      >
        <div role="group" aria-label="Window" className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-line">
          {WINDOWS.map((w) => (
            <Link
              key={w.days}
              href={`/dashboard/observe?days=${w.days}${amp}`}
              aria-current={w.days === days ? "page" : undefined}
              className={`px-3 py-1.5 text-xs font-medium ${w.days === days ? "bg-gray-800 text-white" : "bg-surface text-fg-tertiary hover:bg-sunken"}`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      {/* The one question first: is it the platform? */}
      {platformRows.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">
            {k.platformFailures} run{k.platformFailures === 1 ? "" : "s"} failed because of the platform, not the desks
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
            {platformRows.map((c) => (
              <li key={c.key}>
                <Link href={runHref(c.newest.workspace, c.newest.id, tenant)} className="hover:underline">
                  {c.label}
                </Link>{" "}
                <span className="text-slate-500">
                  — {c.count} run{c.count === 1 ? "" : "s"} on {c.desks.length} desk{c.desks.length === 1 ? "" : "s"}, last {fmtSpan(now - Date.parse(c.newest.startedAt))} ago
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">No desk edit fixes these; once the platform is right, rerun them.</p>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Completed"
          value={pctOf(k.rate)}
          tone={k.rate !== null && k.rate < 0.8 ? "bad" : undefined}
          sub={<Delta now={k.rate} before={k.prevRate} upIsGood as="pts" />}
        />
        <Tile label="Runs" value={k.runs} sub={<span className="text-xs text-fg-muted">{k.finished} finished · {k.runs - k.finished} going</span>} />
        <Tile
          label="Went wrong"
          value={k.deskFailures + k.platformFailures}
          tone={k.deskFailures + k.platformFailures > 0 ? "bad" : "good"}
          sub={
            <span className="text-xs text-fg-tertiary">
              <span className="font-medium">{k.deskFailures}</span> desk · <span className="font-medium">{k.platformFailures}</span> platform
            </span>
          }
        />
        <Tile label="Charged" value={money(k.spendUsd)} sub={<Delta now={k.spendUsd} before={prev.length ? k.prevSpendUsd : null} upIsGood={false} as="money" />} />
        <Tile label="Median run" value={secs(k.medianSecs)} sub={<span className="text-xs text-fg-muted">{k.medianSecs === null ? "fewer than 5 finished runs" : "start to finish"}</span>} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="What each day looked like">
          <div className="p-4">
            <OutcomeChart days={daily} tz={tz} />
          </div>
        </Panel>
        <Panel title="Cost" action={<Link href={`/dashboard/usage${qs}`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Usage →</Link>}>
          <div className="p-4">
            <SpendChart days={daily} />
          </div>
        </Panel>
      </div>

      {insights.length > 0 && (
        <Panel title="Insights — what keeps costing you" count={insights.length} className="mb-4">
          <ul className="divide-y divide-line-faint">
            {insights.slice(0, 8).map((i) => (
              <li key={i.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-fg">{i.title}</span>
                  <span className="rounded bg-muted px-1.5 text-[10px] text-fg-muted">{i.workspace}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-tertiary">
                    {i.credits !== null && i.credits > 0 ? `about ${creditsShort(i.credits / 100)} · ` : ""}
                    {i.steps} step{i.steps === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-fg-tertiary">{i.why}</p>
                <p className="mt-0.5 text-xs text-fg"><span className="text-fg-muted">Fix:</span> {i.fix}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                  {i.evidence.map((e) => (
                    <Link key={`${e.runId}/${e.step}`} href={runHref(e.workspace, e.runId, tenant)} className="font-mono text-fg-muted hover:text-fg hover:underline">
                      {e.runId} · step {e.step}
                    </Link>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Why runs went wrong" count={why.length} className="mb-4">
        {why.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-fg-muted">Nothing went wrong in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Cause</th>
                  <th className={`${TH} text-right`}>Runs</th>
                  <th className={TH}>Desks</th>
                  <th className={TH}>Latest, in its own words</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {why.map((c) => (
                  <tr key={`${c.kind}:${c.key}`} className="hover:bg-sunken/60">
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className={`mr-2 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${CAUSE_TONE[c.kind]}`}>{c.platform ? "platform" : c.kind === "stopped" ? "person" : "desk"}</span>
                      <span className="font-medium text-fg">{c.label}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums text-fg`}>{c.count}</td>
                    <td className={TD}>
                      <div className="flex max-w-[16rem] flex-wrap gap-1">
                        {c.desks.map((d) => (
                          <Link key={d} href={`/dashboard/${d}/observe${qs}`} className="rounded bg-muted px-1.5 text-[10px] text-fg-tertiary hover:bg-muted-strong">
                            {d}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className={`${TD} max-w-[34rem]`}>
                      <Link href={runHref(c.newest.workspace, c.newest.id, tenant)} className="line-clamp-2 text-xs text-fg-tertiary hover:text-fg hover:underline" title={c.sample ?? ""}>
                        {c.sample ?? "—"}
                      </Link>
                      <span className="text-[11px] text-fg-subtle">{c.newest.workspace} · {fmtSpan(now - Date.parse(c.newest.startedAt))} ago</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Desks, worst first" count={desks.length} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Desk</th>
                <th className={`${TH} text-right`}>Runs</th>
                <th className={`${TH} text-right`} title="Ran to the end without failing, of completed + failed runs (stopped left out)">Completed</th>
                <th className={TH}>Trend</th>
                <th className={`${TH} text-right`}>Went wrong</th>
                <th className={TH}>Worst flow</th>
                <th className={`${TH} text-right`}>Median run</th>
                <th className={`${TH} text-right`} title="Credits charged">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {desks.map((d) => {
                const trend = d.rate !== null && d.prevRate !== null ? d.rate - d.prevRate : null;
                return (
                  <tr key={d.workspace} className={`hover:bg-sunken/60 ${d.runs === 0 ? "text-fg-subtle" : ""}`}>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link href={`/dashboard/${d.workspace}/observe${qs}`} className="font-medium text-fg hover:underline">{d.workspace}</Link>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{d.runs || "—"}</td>
                    <td className={`${TD} text-right tabular-nums ${d.rate === null ? "" : d.rate >= 0.8 ? "text-emerald-700" : d.rate >= 0.5 ? "text-amber-700" : "text-red-700"}`}>{pctOf(d.rate)}</td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {trend === null ? (
                        <span className="text-gray-300">—</span>
                      ) : Math.abs(trend) < 0.005 ? (
                        <span className="text-fg-muted">steady</span>
                      ) : (
                        <span className={trend > 0 ? "text-emerald-700" : "text-red-700"}>
                          {trend > 0 ? "▲" : "▼"} {Math.round(Math.abs(trend) * 100)} pts
                        </span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                      {d.deskFailures + d.platformFailures === 0 ? (
                        <span className="text-gray-300">0</span>
                      ) : (
                        <Link href={d.lastBad ? runHref(d.workspace, d.lastBad.id, tenant) : `/dashboard/${d.workspace}/runs${qs}`} className="hover:underline">
                          <span className="font-medium text-red-700">{d.deskFailures}</span>
                          {d.platformFailures > 0 && <span className="text-slate-500"> +{d.platformFailures} platform</span>}
                        </Link>
                      )}
                    </td>
                    <td className={`${TD} text-xs`}>{d.worst ? <span className="text-fg-secondary">{d.worst.what} <span className="text-fg-subtle">×{d.worst.count}</span></span> : <span className="text-gray-300">—</span>}</td>
                    <td className={`${TD} text-right tabular-nums text-xs text-fg-tertiary`}>{secs(d.medianSecs)}</td>
                    <td className={`${TD} text-right tabular-nums text-xs text-fg-tertiary`}>{d.spendUsd ? money(d.spendUsd) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Agents to watch" count={agents.length}>
          {agents.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">No agent ran in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Agent</th>
                  <th className={`${TH} text-right`}>Failed</th>
                  <th className={`${TH} text-right`}>Retried</th>
                  <th className={`${TH} text-right`}>p50</th>
                  <th className={`${TH} text-right`} title="Credits charged">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {agents.map((a) => (
                  <tr key={`${a.workspace}/${a.agent}`} className="hover:bg-sunken/60">
                    <td className={TD}>
                      <Link href={`/dashboard/${a.workspace}/observe${qs}`} className="font-medium text-fg hover:underline">{a.agent}</Link>
                      <span className="ml-1.5 text-[11px] text-fg-subtle">{a.workspace}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums ${a.failed ? "font-medium text-red-700" : "text-gray-300"}`}>
                      {a.failed}<span className="font-normal text-fg-subtle">/{a.steps}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums ${a.retried ? "text-amber-700" : "text-gray-300"}`}>{a.retried}</td>
                    <td className={`${TD} text-right tabular-nums text-xs text-fg-tertiary`}>{secs(a.seconds.p50)}</td>
                    <td className={`${TD} text-right tabular-nums text-xs text-fg-tertiary`}>{money(a.chargedUsd ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Tools" count={tools.length}>
          {tools.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">No tool calls in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Tool</th>
                  <th className={`${TH} text-right`}>Calls</th>
                  <th className={`${TH} text-right`}>Errors</th>
                  <th className={`${TH} text-right`}>Slowest p95</th>
                  <th className={TH}>Used by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {tools.map((t) => (
                  <tr key={t.name} className="hover:bg-sunken/60">
                    <td className={`${TD} font-mono text-xs text-fg`}>{t.name}</td>
                    <td className={`${TD} text-right tabular-nums text-fg-tertiary`}>{t.calls}</td>
                    <td className={`${TD} text-right tabular-nums ${t.errors ? "font-medium text-red-700" : "text-gray-300"}`}>
                      {t.errors}
                      {t.errors > 0 && <span className="font-normal text-fg-subtle"> · {Math.round((t.errors / t.calls) * 100)}%</span>}
                    </td>
                    <td className={`${TD} text-right tabular-nums text-xs text-fg-tertiary`} title="Only tools that time themselves report a latency">
                      {t.p95ms === null ? "—" : t.p95ms >= 1000 ? `${(t.p95ms / 1000).toFixed(1)}s` : `${Math.round(t.p95ms)}ms`}
                    </td>
                    <td className={`${TD} text-[11px] text-fg-muted`}>{t.workspaces.length === 1 ? t.workspaces[0] : `${t.workspaces.length} desks`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </main>
  );
}
