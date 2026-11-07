// The account's consumption, as a page: what ran, what it used, what it
// cost, and where the bytes live — per workspace, with each workspace's
// flows and agents broken out. Every number is rolled up from the run
// records and file stores at render time; there is no second counter to
// drift from the facts.

import { Page, PageHeader, SectionTitle, StatGrid, Stat, Callout } from "@/components/kit/page";
import { PageTabs } from "@/components/kit/page-tabs";
import { Segmented } from "@/components/kit/segmented";
import { billing } from "@/platform/billing";
import { fmtTokens, periodQuery } from "@/components/usage-format";
import { CreditsBlock, TokensTab, ComputeTab, RatesTab } from "./tabs";
import { accountUsage, spendHistory, type UsageBucket, type SpendSeries } from "@/platform/usage";
import { LocalTime } from "@/components/local-time";
import { credits, usd, usdExact } from "@/components/money";
import { DataTable } from "@/components/kit/table";
import { Tooltip } from "@/components/kit/tooltip";
import { Sparkbars } from "@/components/kit/chart";
import { CollapsibleCard, CollapseAll } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import { BillingTabs } from "@/components/billing-tabs";
import { platform } from "@/lib/platform";
import { viewerScope } from "@/server/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Usage" };

const GB = 1024 * 1024 * 1024;
const fmtBytes = (b: number) =>
  b >= GB ? `${(b / GB).toFixed(2)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;
// The share the cache served, over steps that report it (18 Oct 2026 on).
const fmtHit = (b: UsageBucket) => (b.cacheHitRate == null ? null : `${Math.round(b.cacheHitRate * 100)}%`);
const fmtMins = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${(secs / 60).toFixed(1)} min`);

const dim = <span className="text-fg-subtle">—</span>;

const BUCKET_COLUMNS = [
  { label: "\u00a0" },
  { label: "Runs", align: "right" as const },
  { label: "Steps", align: "right" as const },
  { label: "Tokens in/out", align: "right" as const },
  { label: "Cached", align: "right" as const },
  { label: "Sandbox", align: "right" as const },
  { label: "Models", align: "right" as const },
  { label: "Platform*", align: "right" as const },
  { label: "Total", align: "right" as const },
];

function bucketCells(b: UsageBucket) {
  return [
    b.runs,
    b.steps,
    b.inputTokens + b.outputTokens > 0 ? `${fmtTokens(b.inputTokens)} / ${fmtTokens(b.outputTokens)}` : "—",
    <Tooltip key="c" label={b.cacheHitRate == null ? "no step here reports cache reads yet" : `${fmtTokens(b.cacheReadTokens)} of ${fmtTokens(b.measuredInputTokens)} input tokens read from the prompt cache`}>
      <span>{fmtHit(b) ?? dim}</span>
    </Tooltip>,
    fmtMins(b.computeSecs),
    <Tooltip key="m" label={`${usdExact(b.modelUsd)} · provider cost ${usdExact(b.tokenCostUsd)}`}>
      <span>{b.modelUsd > 0 ? credits(b.modelUsd) : dim}</span>
    </Tooltip>,
    <Tooltip key="p" label={`${usdExact(b.platformUsd)} · ${fmtMins(b.cpuSecs)} CPU·s and ${fmtMins(b.gibSecs)} GiB·s reserved`}>
      <span>{b.platformUsd > 0 ? credits(b.platformUsd) : dim}</span>
    </Tooltip>,
    <Tooltip key="t" label={`${usdExact(b.listUsd)} at today's rates`}>
      <span className="font-medium">{credits(b.listUsd)}</span>
    </Tooltip>,
  ];
}

/**
 * What each flow or agent has cost, week by week.
 *
 * A sparkline rather than a chart: the question this answers is "is this
 * getting more expensive", and a row of bars against the period's own worst
 * week says that in the width of a table cell. The number beside it is the
 * comparison that matters — the last complete period against the one
 * before, so a partial week never reports a desk as collapsing.
 */
function SpendTable({ title, rows, unit }: { title: string; rows: SpendSeries[]; unit: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(0.000001, ...rows.flatMap((r) => r.periods.map((p) => p.usd)));
  return (
    <DataTable
      title={title}
      minWidth="min-w-[480px]"
      columns={[{ label: unit }, { label: "Runs", align: "right" }, { label: "Over time" }, { label: "Change", align: "right" }, { label: "Charged", align: "right" }]}
      rows={rows.slice(0, 20).map((s) => ({
        key: s.name,
        cells: [
          <span key="n" className="font-medium">{s.name}</span>,
          s.runs || "—",
          <Sparkbars
            key="b"
            height={24}
            max={max}
            className="w-28"
            bars={s.periods.map((p) => ({ key: p.period, value: p.usd, title: `${p.period}: ${usd(p.usd)}${p.runs ? ` over ${p.runs} runs` : ""}` }))}
          />,
          s.change === null ? (
            <span key="c" className="text-fg-subtle">—</span>
          ) : (
            <span key="c" className={s.change > 0.15 ? "text-danger" : s.change < -0.15 ? "text-success" : "text-fg-muted"}>
              {s.change > 0 ? "+" : ""}
              {Math.round(s.change * 100)}%
            </span>
          ),
          <span key="u" className="font-medium">{usd(s.totalUsd)}</span>,
        ],
      }))}
    />
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tokens", label: "Tokens" },
  { key: "compute", label: "Compute" },
  { key: "rates", label: "Rates" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Presets for the Tokens and Compute period; the API and CLI take any days.
const PERIODS = [
  { key: "month", label: "This month", days: 0 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;
const DAY_MS = 86_400_000;
/** [from, to] as UTC days; 0 is the month so far (the API's default, so no query). */
function periodDays(days: number): [string | undefined, string | undefined] {
  if (days === 0) return [undefined, undefined];
  const now = Date.now();
  return [new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10)];
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; tab?: string; from?: string; to?: string }>;
}) {
  const { tenant = "default", tab: rawTab, from, to } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "overview";
  // A member scoped to some workspaces sees those, as GET /api/usage answers.
  const scope = await viewerScope();
  // The period bounds Tokens and Compute, as ?from&to do the API's; a bad day
  // is said, and the month so far shown.
  let periodError: string | null = null;
  let u: Awaited<ReturnType<typeof accountUsage>>;
  try {
    u = await accountUsage(tenant, { workspaces: scope, from, to });
  } catch (err) {
    periodError = err instanceof Error ? err.message : "that period cannot be shown";
    u = await accountUsage(tenant, { workspaces: scope });
  }
  // Which preset the shown period is, when it is one.
  const range = PERIODS.find((r) => { const [f, t] = periodDays(r.days); return r.days === 0 ? from === undefined && to === undefined : f === u.period.from && t === u.period.to; })?.key ?? "custom";
  const b = billing();
  const rates = tab === "rates" ? b.meterRates?.() ?? null : null;
  const catalogue = tab === "rates" ? b.catalogue?.() ?? null : null;
  // From the ledger, not the run records: this is what was actually charged,
  // and it survives runs being pruned — which is exactly when a desk's cost
  // history starts being worth having.
  const history = tab === "overview" ? await spendHistory(tenant, 56, { workspaces: scope }) : null;

  return (
    <Page className="pb-16">
      <PageHeader
        title={platform.edition() === "hosted" ? "Billing" : "Usage"}
        description={
          <>
            Everything this account has consumed, from the run records themselves. Generated <LocalTime iso={u.generatedAt} />.
          </>
        }
      />
      <BillingTabs current="usage" tenant={tenant} hosted={platform.edition() === "hosted"} />
      <PageTabs
        label="Usage"
        className="mb-6"
        tabs={TABS.map((t) => ({ label: t.label, href: periodQuery(tenant, t.key, from, to), active: t.key === tab }))}
      />
      {periodError && (
        <Callout tone="warning" role="alert" className="mb-4">
          {periodError}. Showing {u.period.from} to {u.period.to}.
        </Callout>
      )}
      {(tab === "tokens" || tab === "compute") && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Period"
            value={range}
            items={PERIODS.map((r) => ({ key: r.key, label: r.label, href: periodQuery(tenant, tab, ...periodDays(r.days)) }))}
          />
          <p className="text-xs text-fg-muted">
            {u.period.from} to {u.period.to}, UTC. Any other period: <code className="font-mono">?from=</code> and <code className="font-mono">&amp;to=</code> in the address, <code className="font-mono">--since</code> and <code className="font-mono">--until</code> in the CLI. The overview covers every retained run.
          </p>
        </div>
      )}

      {tab === "tokens" && <TokensTab u={u} />}
      {tab === "compute" && <ComputeTab u={u} />}
      {tab === "rates" && <RatesTab rates={rates} catalogue={catalogue} planId={u.credits?.plan?.id ?? null} />}
      {tab === "overview" && (
        <>
          <CreditsBlock c={u.credits} />

      {u.waived && u.waived.length > 0 && (
        <Callout tone="success" role="status" className="mb-4">
          This account is not charged for{" "}
          {u.waived.map((w) => (w === "models" ? "model tokens" : w === "compute" ? "sandbox time" : "network")).join(", ")}
          . Everything below is still measured — it is simply not billed, and each run&apos;s ledger line says so.
        </Callout>
      )}

      <StatGrid className="mb-10 md:grid-cols-4 xl:grid-cols-4">
        <Stat label="Runs" value={u.totals.runs} />
        <Stat label="Tokens in / out" value={`${fmtTokens(u.totals.inputTokens)} / ${fmtTokens(u.totals.outputTokens)}`} />
        <Stat label="Cache hit rate" value={fmtHit(u.totals) ?? "—"} />
        <Stat label="Sandbox time" value={fmtMins(u.totals.computeSecs)} />
        <Stat label="Models" value={credits(u.totals.modelUsd)} />
        <Stat label="Platform" value={credits(u.totals.platformUsd)} />
        <Stat label="Storage" value={fmtBytes(u.totals.storageBytes)} />
        {/* The wallet is the whole account's: not shown to a member limited
            to some workspaces (ledger: null, 30 Oct 2026). */}
        <Stat label="Credit balance" value={u.ledger ? credits(u.ledger.balanceUsd) : "—"} />
      </StatGrid>

      {/* What each desk and each agent costs, and whether that is moving.
          The question this page previously could not answer: not "what did
          we spend" but "which of these is worth keeping". */}
      {history && history.totalUsd > 0 && (
        <section className="mb-10">
          <SectionTitle
            title={`What it costs, by ${history.bucket}`}
            description={
              <>
                Charged spend from the ledger, last {history.periods.length} {history.bucket}
                {history.periods.length === 1 ? "" : "s"}
                {history.unattributedUsd > 0 ? ` · ${usd(history.unattributedUsd)} from before charges recorded which flow they were` : ""}
              </>
            }
          />
          {(history.modelUsd > 0 || history.platformUsd > 0) && (
            <div className="mb-4 rounded-lg border border-line bg-surface p-5">
              <p className="text-sm font-medium text-fg">Where the money went, this window</p>
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="models against platform">
                <span className="bg-fg" style={{ width: `${(history.modelUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
                <span className="bg-success" style={{ width: `${(history.platformUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-fg" aria-hidden />
                  <dt className="text-fg-muted">Models</dt>
                  <dd className="tabular-nums font-medium text-fg">{credits(history.modelUsd)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-success" aria-hidden />
                  <dt className="text-fg-muted">Platform</dt>
                  <dd className="tabular-nums font-medium text-fg">{credits(history.platformUsd)}</dd>
                </div>
                {history.unsplitUsd > 0 && (
                  <div className="flex items-center gap-2">
                    <dt className="text-fg-subtle">Before the split was recorded</dt>
                    <dd className="tabular-nums text-fg-muted">{credits(history.unsplitUsd)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SpendTable title="By flow" rows={history.byFlow} unit="Flow" />
            <SpendTable title="By agent" rows={history.byAgent} unit="Agent" />
          </div>
        </section>
      )}

      {u.workspaces.length > 1 && (
        <SectionTitle title="By workspace" description="Each workspace, with its flows and agents broken out." actions={<CollapseAll scope="usage" />} />
      )}
      <div className="mb-8 space-y-3">
      {u.workspaces.map((ws) => (
        <CollapsibleCard
          key={ws.workspace}
          id={anchorId("usage", ws.workspace)}
          scope="usage"
          item={ws.workspace}
          // One workspace is the whole page; nothing to collapse it against.
          defaultOpen={u.workspaces.length === 1}
          inline
          title={ws.workspace}
          meta={
            <span className="text-xs tabular-nums text-fg-muted">
              {ws.runs} run{ws.runs === 1 ? "" : "s"} · {credits(ws.listUsd)} · source {fmtBytes(ws.storage.sourceBytes)} · files{" "}
              {fmtBytes(ws.storage.filesBytes)} · run history {fmtBytes(ws.storage.runsBytes)}
            </span>
          }
          bodyClassName="border-t border-line p-3"
        >
          <DataTable
            columns={BUCKET_COLUMNS}
            rows={[
              { key: "whole", cells: [<span key="w" className="font-medium">whole workspace</span>, ...bucketCells(ws)] },
              ...Object.entries(ws.byFlow).map(([flow, b]) => ({
                key: `f-${flow}`,
                cells: [
                  <span key="f">
                    <span className="text-fg-subtle">{flow.startsWith("adhoc:") ? "agent run · " : flow.startsWith("eval:") ? "eval · " : "flow · "}</span>
                    {flow.replace(/^adhoc:|^eval:/, "")}
                  </span>,
                  ...bucketCells(b),
                ],
              })),
              ...Object.entries(ws.byAgent)
                .sort(([, a], [, b]) => b.tokenCostUsd - a.tokenCostUsd)
                .map(([agent, b]) => ({
                  key: `a-${agent}`,
                  cells: [
                    <span key="a" className="pl-3 text-fg-muted">
                      <span className="text-fg-subtle">agent · </span>
                      {agent}
                    </span>,
                    ...bucketCells(b),
                  ],
                })),
            ]}
          />
        </CollapsibleCard>
      ))}
      </div>

      <p className="max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
        <strong className="font-medium text-fg">Models</strong> is what the model calls list at — the provider&apos;s price with the
        platform&apos;s margin. On your own model key it is zero: those tokens are billed to your
        provider account, never through us. <strong className="font-medium text-fg">Platform</strong> is everything underneath —
        the sandbox each step reserved and the network it moved. Hover either for the dollars and
        the reservations behind it.
        <br />
        * The reservation is sandbox seconds × the pod limits in force ({u.podLimits.cpus} CPU,{" "}
        {u.podLimits.memoryGiB} GiB per step); what a step actually touched inside it is not
        metered, because reserved capacity is the quantity compute is priced on. Flow rows count
        whole runs; agent rows attribute each step to the agent that ran it, so the two views sum
        to the same totals by different cuts.
      </p>
        </>
      )}
    </Page>
  );
}
