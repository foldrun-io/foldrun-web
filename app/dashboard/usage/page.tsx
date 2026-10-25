// The account's consumption, as a page: what ran, what it used, what it
// cost, and where the bytes live — per workspace, with each workspace's
// flows and agents broken out. Every number is rolled up from the run
// records and file stores at render time; there is no second counter to
// drift from the facts.

import { PageHeader, Card, SectionHeading, StatCard } from "@/components/ui";
import { accountUsage, spendHistory, type UsageBucket, type SpendSeries } from "@/platform/usage";
import { LocalTime } from "@/components/local-time";
import { credits, usd, usdExact } from "@/components/money";
import { DataTable, Sparkbars } from "@/components/data";
import { Banner } from "@/components/banner";
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
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
// The share the cache served, over steps that report it (18 Oct 2026 on).
const fmtHit = (b: UsageBucket) => (b.cacheHitRate == null ? null : `${Math.round(b.cacheHitRate * 100)}%`);
const fmtMins = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${(secs / 60).toFixed(1)} min`);

const dim = <span className="text-gray-300">—</span>;

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
    <span key="c" title={b.cacheHitRate == null ? "no step here reports cache reads yet" : `${fmtTokens(b.cacheReadTokens)} of ${fmtTokens(b.measuredInputTokens)} input tokens read from the prompt cache`}>
      {fmtHit(b) ?? dim}
    </span>,
    fmtMins(b.computeSecs),
    <span key="m" title={`${usdExact(b.modelUsd)} · provider cost ${usdExact(b.tokenCostUsd)}`}>{b.modelUsd > 0 ? credits(b.modelUsd) : dim}</span>,
    <span key="p" title={`${usdExact(b.platformUsd)} · ${fmtMins(b.cpuSecs)} CPU·s and ${fmtMins(b.gibSecs)} GiB·s reserved`}>
      {b.platformUsd > 0 ? credits(b.platformUsd) : dim}
    </span>,
    <span key="t" className="font-medium" title={`${usdExact(b.listUsd)} at today's rates`}>{credits(b.listUsd)}</span>,
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
            <span key="c" className={s.change > 0.15 ? "text-red-600" : s.change < -0.15 ? "text-emerald-700" : "text-fg-muted"}>
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

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant = "default" } = await searchParams;
  // A member scoped to some workspaces sees those, as GET /api/usage answers.
  const scope = await viewerScope();
  const u = await accountUsage(tenant, { workspaces: scope });
  // From the ledger, not the run records: this is what was actually charged,
  // and it survives runs being pruned — which is exactly when a desk's cost
  // history starts being worth having.
  const history = await spendHistory(tenant, 56, { workspaces: scope });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title={platform.edition() === "hosted" ? "Billing" : "Usage"}
        subtitle={
          <>
            Everything this account has consumed, from the run records themselves. Generated{" "}
            <LocalTime iso={u.generatedAt} />.
          </>
        }
      />
      <BillingTabs current="usage" tenant={tenant} hosted={platform.edition() === "hosted"} />

      {u.waived.length > 0 && (
        <Banner tone="ok">
          This account is not charged for{" "}
          {u.waived.map((w) => (w === "models" ? "model tokens" : w === "compute" ? "sandbox time" : "network")).join(", ")}
          . Everything below is still measured — it is simply not billed, and each run&apos;s ledger line says so.
        </Banner>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-8">
        <StatCard label="Runs" value={u.totals.runs} />
        <StatCard label="Tokens in / out" value={`${fmtTokens(u.totals.inputTokens)} / ${fmtTokens(u.totals.outputTokens)}`} />
        <StatCard label="Cache hit rate" value={fmtHit(u.totals) ?? "—"} />
        <StatCard label="Sandbox time" value={fmtMins(u.totals.computeSecs)} />
        <StatCard label="Models" value={credits(u.totals.modelUsd)} />
        <StatCard label="Platform" value={credits(u.totals.platformUsd)} />
        <StatCard label="Storage" value={fmtBytes(u.totals.storageBytes)} />
        <StatCard label="Credit balance" value={credits(u.ledger.balanceUsd)} />
      </div>

      {/* What each desk and each agent costs, and whether that is moving.
          The question this page previously could not answer: not "what did
          we spend" but "which of these is worth keeping". */}
      {history.totalUsd > 0 && (
        <section className="mb-8">
          <SectionHeading>
            What it costs, by {history.bucket}
            <span className="ml-2 font-normal normal-case text-fg-subtle">
              charged spend from the ledger, last {history.periods.length} {history.bucket}
              {history.periods.length === 1 ? "" : "s"}
              {history.unattributedUsd > 0
                ? ` · ${usd(history.unattributedUsd)} from before charges recorded which flow they were`
                : ""}
            </span>
          </SectionHeading>
          {(history.modelUsd > 0 || history.platformUsd > 0) && (
            <Card className="mb-4 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Where the money went, this window</p>
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="models against platform">
                <span className="bg-gray-800" style={{ width: `${(history.modelUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
                <span className="bg-emerald-500" style={{ width: `${(history.platformUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-gray-800" aria-hidden />
                  <dt className="text-fg-muted">Models</dt>
                  <dd className="tabular-nums font-medium text-fg">{credits(history.modelUsd)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
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
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SpendTable title="By flow" rows={history.byFlow} unit="Flow" />
            <SpendTable title="By agent" rows={history.byAgent} unit="Agent" />
          </div>
        </section>
      )}

      {u.workspaces.length > 1 && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <SectionHeading>By workspace</SectionHeading>
          <CollapseAll scope="usage" />
        </div>
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
          bodyClassName="border-t border-line-faint p-3"
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

      <p className="mt-2 text-xs text-fg-subtle">
<strong>Models</strong> is what the model calls list at — the provider&apos;s price with the
        platform&apos;s margin. On your own model key it is zero: those tokens are billed to your
        provider account, never through us. <strong>Platform</strong> is everything underneath —
        the sandbox each step reserved and the network it moved. Hover either for the dollars and
        the reservations behind it.
        <br />
        * The reservation is sandbox seconds × the pod limits in force ({u.podLimits.cpus} CPU,{" "}
        {u.podLimits.memoryGiB} GiB per step); what a step actually touched inside it is not
        metered, because reserved capacity is the quantity compute is priced on. Flow rows count
        whole runs; agent rows attribute each step to the agent that ran it, so the two views sum
        to the same totals by different cuts.
      </p>
    </main>
  );
}
