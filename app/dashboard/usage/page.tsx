// The account's consumption, as a page: what ran, what it used, what it
// cost, and where the bytes live — per workspace, with each workspace's
// flows and agents broken out. Every number is rolled up from the run
// records and file stores at render time; there is no second counter to
// drift from the facts.

import { $el, $rich, $t, localizedList } from "@/i18n";
import { Page, PageHeader, SectionTitle, StatGrid, Stat, Callout } from "@foldrun/ui/react/page";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { Segmented } from "@foldrun/ui/react/segmented";
import { billing } from "@/platform/billing";
import { fmtTokens, periodQuery } from "@/components/usage-format";
import { CreditsBlock, TokensTab, ComputeTab, RatesTab } from "./tabs";
import { accountUsage, spendHistory, type UsageBucket, type SpendSeries } from "@/platform/usage";
import { LocalTime } from "@/components/local-time";
import { credits, usd, usdExact } from "@/components/money";
import { DataTable } from "@foldrun/ui/react/table";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Sparkbars } from "@foldrun/ui/react/chart";
import { CollapsibleCard, CollapseAll } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import { BillingTabs } from "@/components/billing-tabs";
import { platform } from "@/lib/platform";
import { viewerScope } from "@/server/users";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("usage.page.billingUsage") };
}

const GB = 1024 * 1024 * 1024;
const fmtBytes = (b: number) =>
  b >= GB ? `${(b / GB).toFixed(2)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;
// The share the cache served, over steps that report it (18 Oct 2026 on).
const fmtHit = (b: UsageBucket) => (b.cacheHitRate == null ? null : `${Math.round(b.cacheHitRate * 100)}%`);
const fmtMins = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${(secs / 60).toFixed(1)} min`);

const dim = <span className="text-fg-subtle">—</span>;

const BUCKET_COLUMNS = localizedList(() => [
  { label: "\u00a0" },
  { label: $t("usage.page.runs"), align: "right" as const },
  { label: $t("usage.page.steps"), align: "right" as const },
  { label: $t("usage.page.tokensInOutColumn"), align: "right" as const },
  { label: $t("usage.page.cached"), align: "right" as const },
  { label: $t("usage.page.sandbox"), align: "right" as const },
  { label: $t("usage.page.models"), align: "right" as const },
  { label: $t("usage.page.platform2"), align: "right" as const },
  { label: $t("usage.page.total"), align: "right" as const },
]);

function bucketCells(b: UsageBucket) {
  return [
    b.runs,
    b.steps,
    b.inputTokens + b.outputTokens > 0 ? `${fmtTokens(b.inputTokens)} / ${fmtTokens(b.outputTokens)}` : "—",
    <Tooltip key="c" label={b.cacheHitRate == null ? $t("usage.page.noStepHereReportsCacheReads") : $t("usage.page.ofInputTokensReadFromThe", { v0: String(fmtTokens(b.cacheReadTokens)), v1: String(fmtTokens(b.measuredInputTokens)) })}>
      <span>{fmtHit(b) ?? dim}</span>
    </Tooltip>,
    fmtMins(b.computeSecs),
    <Tooltip key="m" label={$t("usage.page.providerCost", { v0: String(usdExact(b.modelUsd)), v1: String(usdExact(b.tokenCostUsd)) })}>
      <span>{b.modelUsd > 0 ? credits(b.modelUsd) : dim}</span>
    </Tooltip>,
    <Tooltip key="p" label={$t("usage.page.cpuSAndGibSReserved", { v0: String(usdExact(b.platformUsd)), v1: String(fmtMins(b.cpuSecs)), v2: String(fmtMins(b.gibSecs)) })}>
      <span>{b.platformUsd > 0 ? credits(b.platformUsd) : dim}</span>
    </Tooltip>,
    <Tooltip key="t" label={$t("usage.page.atTodaySRates", { v0: String(usdExact(b.listUsd)) })}>
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
      columns={[{ label: unit }, { label: $t("usage.page.runs"), align: "right" }, { label: $t("usage.page.overTime") }, { label: $t("usage.page.change"), align: "right" }, { label: $t("usage.page.charged"), align: "right" }]}
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
            bars={s.periods.map((p) => ({ key: p.period, value: p.usd, title: `${p.period}: ${usd(p.usd)}${p.runs ? $t("usage.page.overRuns", { runs: String(p.runs) }) : ""}` }))}
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

const TABS = localizedList(() => ([
  { key: "overview", label: $t("usage.page.overview") },
  { key: "tokens", label: $t("usage.page.tokens") },
  { key: "compute", label: $t("usage.page.compute") },
  { key: "rates", label: $t("usage.page.rates") },
] as const));
type TabKey = (typeof TABS)[number]["key"];

// Presets for the Tokens and Compute period; the API and CLI take any days.
const PERIODS = localizedList(() => ([
  { key: "month", label: $t("usage.page.thisMonth"), days: 0 },
  { key: "7", label: $t("usage.page.last7Days"), days: 7 },
  { key: "30", label: $t("usage.page.last30Days"), days: 30 },
  { key: "90", label: $t("usage.page.last90Days"), days: 90 },
] as const));
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
  await requestLocale();
  const { tenant = "default", tab: rawTab, from, to } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "overview";
  // A member scoped to some workspaces sees those, as GET /v1/account/usage answers.
  const scope = await viewerScope();
  // The period bounds Tokens and Compute, as ?from&to do the API's; a bad day
  // is said, and the month so far shown.
  let periodError: string | null = null;
  let u: Awaited<ReturnType<typeof accountUsage>>;
  try {
    u = await accountUsage(tenant, { workspaces: scope, from, to });
  } catch (err) {
    periodError = err instanceof Error ? err.message : $t("usage.page.thatPeriodCannotBeShown");
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
  // The "yours" mark on the Rates tab: the subscription size the account is on,
  // never an old platform plan's id (Codex, 27 Nov 2026).
  const ent = tab === "rates" ? await billing().entitlement?.(tenant).catch(() => null) : null;
  const subscriptionSize = ent && ent.kind === "active" && ent.source === "subscription" ? ent.plan : null;

  return (
    <Page className="pb-16">
      <PageHeader
        title={platform.edition() === "hosted" ? $t("usage.page.billing") : $t("usage.page.usage")}
        description={
          <>
            {$rich("usage.page.everythingThisAccountHasConsumedFrom", { localTime: $el(<LocalTime iso={u.generatedAt} />) })}
          </>
        }
      />
      <BillingTabs current="usage" tenant={tenant} hosted={platform.edition() === "hosted"} />
      <PageTabs
        label={$t("usage.page.usage")}
        className="mb-6"
        tabs={TABS.map((t) => ({ label: t.label, href: periodQuery(tenant, t.key, from, to), active: t.key === tab }))}
      />
      {periodError && (
        <Callout tone="warning" role="alert" className="mb-4">
          {$t("usage.page.showingTo", { periodError: periodError, from: u.period.from, to: u.period.to })}
        </Callout>
      )}
      {(tab === "tokens" || tab === "compute") && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label={$t("usage.page.period")}
            value={range}
            items={PERIODS.map((r) => ({ key: r.key, label: r.label, href: periodQuery(tenant, tab, ...periodDays(r.days)) }))}
          />
          <p className="text-xs text-fg-muted">
            {$rich("usage.page.toUtcAnyOtherPeriodFrom", { from: u.period.from, to: u.period.to, code: (chunks) => <code className="font-mono">{chunks}</code> })}
          </p>
        </div>
      )}

      {tab === "tokens" && <TokensTab u={u} />}
      {tab === "compute" && <ComputeTab u={u} />}
      {tab === "rates" && <RatesTab rates={rates} catalogue={catalogue} planId={subscriptionSize} />}
      {tab === "overview" && (
        <>
          <CreditsBlock c={u.credits} />

      {u.waived && u.waived.length > 0 && (
        <Callout tone="success" role="status" className="mb-4">
          {$t("usage.page.thisAccountIsNotChargedFor")}{" "}
          {u.waived.map((w) => (w === "models" ? $t("usage.page.modelTokens") : w === "compute" ? $t("usage.page.sandboxTime") : "network")).join(", ")}
          {$t("usage.page.everythingBelowIsStillMeasuredIt")}
        </Callout>
      )}

      <StatGrid className="mb-10 md:grid-cols-4 xl:grid-cols-4">
        <Stat label={$t("usage.page.runs")} value={u.totals.runs} />
        <Stat label={$t("usage.page.tokensInOut")} value={`${fmtTokens(u.totals.inputTokens)} / ${fmtTokens(u.totals.outputTokens)}`} />
        <Stat label={$t("usage.page.cacheHitRate")} value={fmtHit(u.totals) ?? "—"} />
        <Stat label={$t("usage.page.sandboxTime2")} value={fmtMins(u.totals.computeSecs)} />
        <Stat label={$t("usage.page.models")} value={credits(u.totals.modelUsd)} />
        <Stat label={$t("usage.page.platform")} value={credits(u.totals.platformUsd)} />
        <Stat label={$t("usage.page.storage")} value={fmtBytes(u.totals.storageBytes)} />
        {/* The wallet is the whole account's: not shown to a member limited
            to some workspaces (ledger: null, 30 Oct 2026). */}
        <Stat label={$t("usage.page.balanceInCredits")} value={u.ledger ? credits(u.ledger.balanceUsd) : "—"} />
      </StatGrid>

      {/* What each desk and each agent costs, and whether that is moving.
          The question this page previously could not answer: not "what did
          we spend" but "which of these is worth keeping". */}
      {history && history.totalUsd > 0 && (
        <section className="mb-10">
          <SectionTitle
            title={$t("usage.page.whatItCostsBy", { bucket: String(history.bucket) })}
            description={
              <>
                {$t("usage.page.chargedSpendFromTheLedgerLast", { length: history.periods.length, bucket: history.bucket })}
                {history.unattributedUsd > 0 ? $t("usage.page.fromBeforeChargesRecordedWhichFlow", { v0: String(usd(history.unattributedUsd)) }) : ""}
              </>
            }
          />
          {(history.modelUsd > 0 || history.platformUsd > 0) && (
            <div className="mb-4 rounded-lg border border-line bg-surface p-5">
              <p className="text-sm font-medium text-fg">{$t("usage.page.whereTheMoneyWentThisWindow")}</p>
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={$t("usage.page.modelsAgainstPlatform")}>
                <span className="bg-fg" style={{ width: `${(history.modelUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
                <span className="bg-success" style={{ width: `${(history.platformUsd / Math.max(0.000001, history.modelUsd + history.platformUsd)) * 100}%` }} />
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-fg" aria-hidden />
                  <dt className="text-fg-muted">{$t("usage.page.models")}</dt>
                  <dd className="tabular-nums font-medium text-fg">{credits(history.modelUsd)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-success" aria-hidden />
                  <dt className="text-fg-muted">{$t("usage.page.platform")}</dt>
                  <dd className="tabular-nums font-medium text-fg">{credits(history.platformUsd)}</dd>
                </div>
                {history.unsplitUsd > 0 && (
                  <div className="flex items-center gap-2">
                    <dt className="text-fg-subtle">{$t("usage.page.beforeTheSplitWasRecorded")}</dt>
                    <dd className="tabular-nums text-fg-muted">{credits(history.unsplitUsd)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SpendTable title={$t("usage.page.byFlow")} rows={history.byFlow} unit="Flow" />
            <SpendTable title={$t("usage.page.byAgent")} rows={history.byAgent} unit="Agent" />
          </div>
        </section>
      )}

      {u.workspaces.length > 1 && (
        <SectionTitle title={$t("usage.page.byWorkspace")} description={$t("usage.page.eachWorkspaceWithItsFlowsAnd")} actions={<CollapseAll scope="usage" />} />
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
              {$t("usage.page.runSourceFilesRunHistory", { runs: ws.runs, credits: credits(ws.listUsd), fmtBytes: fmtBytes(ws.storage.sourceBytes), fmtBytes2: fmtBytes(ws.storage.filesBytes), fmtBytes3: fmtBytes(ws.storage.runsBytes) })}
            </span>
          }
          bodyClassName="border-t border-line p-3"
        >
          <DataTable
            columns={BUCKET_COLUMNS}
            rows={[
              { key: "whole", cells: [<span key="w" className="font-medium">{$t("usage.page.wholeWorkspace")}</span>, ...bucketCells(ws)] },
              ...Object.entries(ws.byFlow).map(([flow, b]) => ({
                key: `f-${flow}`,
                cells: [
                  <span key="f">
                    <span className="text-fg-subtle">{flow.startsWith("adhoc:") ? $t("usage.page.agentRun") : flow.startsWith("eval:") ? $t("usage.page.eval") : $t("usage.page.flow")}</span>
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
                      <span className="text-fg-subtle">{$t("usage.page.agent")}{" "}</span>
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
        {$rich("usage.page.modelsIsWhatTheModelCalls", { strong: (chunks) => <strong className="font-medium text-fg">{chunks}</strong>, br: $el(<br />), cpus: String(u.podLimits.cpus), memoryGiB: String(u.podLimits.memoryGiB) })}
      </p>
        </>
      )}
    </Page>
  );
}
