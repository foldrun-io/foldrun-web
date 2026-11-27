// The Usage page's Tokens, Compute and Rates tabs and the credits block
// (FOL-125). Server components over what GET /v1/account/usage and GET /v1/account/usage/rates
// answer: the page and the API read the same function, so they cannot differ.

import { $el, $rich, $t } from "@/i18n";
import { Calculator, Coins } from "lucide-react";
import { Callout, Chip, EmptyState, SectionTitle, Stat, StatGrid } from "@foldrun/ui/react/page";
import { DataTable } from "@foldrun/ui/react/table";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { LocalTime } from "@/components/local-time";
import { credits, usd, usdExact } from "@/components/money";
import { METER_NAMES, SUPPLY_NAMES, fmtCredits, fmtQuantity, fmtTokens, rateUnit } from "@/components/usage-format";
import type { UsageBreakdowns } from "@/platform/usage-breakdown";
import type { MeterRates, PricingCatalogue } from "@/platform/billing";

const dim = <span className="text-fg-subtle">—</span>;

/** The two credit pots, apart: plan credits cannot pay for tokens on
 *  foldrun's models, bought credits can. Null where the caller may not read the wallet. */
export function CreditsBlock({ c }: { c: UsageBreakdowns["credits"] }) {
  if (!c) return null;
  const plan = c.plan;
  return (
    <section className="mb-10">
      <SectionTitle title={$t("usage.tabs.yourCredits")} description={plan?.paysForTokens ? $t("usage.tabs.oneCreditOneWallet") : $t("usage.tabs.oneCreditIsOneCentTwo")} />
      <StatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <Stat
          label={$t("usage.tabs.planCredits")}
          value={credits(c.pots.planUsd)}
          sub={plan ? $t("usage.tabs.creditsAMonth", { name: String(plan.name), v1: String(fmtCredits(plan.creditsPerMonth)) }) : $t("usage.tabs.noPlan")}
        />
        <Stat
          label={$t("usage.tabs.boughtCredits")}
          value={credits(c.pots.boughtUsd)}
          sub={c.boughtOldestExpiresAt ? <>{$rich("usage.tabs.theOldestExpires", { localTime: $el(<LocalTime iso={c.boughtOldestExpiresAt} />) })}</> : $t("usage.tabs.topUpsLast12Months")}
        />
        <Stat
          label={$t("usage.tabs.plan")}
          value={plan?.name ?? "—"}
          sub={plan ? (plan.rollover ? $t("usage.tabs.unusedCreditsRollOverUpTo", { v0: String(fmtCredits(plan.rolloverCapCredits)) }) : $t("usage.tabs.unusedCreditsAreLostAtMonth")) : undefined}
        />
      </StatGrid>
      {plan?.resetsAt && (
        <p className="mt-2 px-1 text-xs text-fg-muted">
          {plan.rollover ? $t("usage.tabs.thePlanRenews") : $t("usage.tabs.planCreditsReset")} <LocalTime iso={plan.resetsAt} />.
        </p>
      )}
    </section>
  );
}

export function TokensTab({ u }: { u: UsageBreakdowns }) {
  const t = u.tokens;
  if (t.byModel.length === 0) {
    return <EmptyState icon={<Coins />} title={$t("usage.tabs.noModelCallsInThisPeriod")} description={$t("usage.tabs.callsShowHereByProviderAnd")} />;
  }
  return (
    <>
      <StatGrid className="mb-8 md:grid-cols-3 xl:grid-cols-3">
        <Stat label={$t("usage.tabs.modelCalls")} value={t.totals.calls} />
        <Stat label={$t("usage.tabs.billed")} value={`${fmtCredits(t.totals.billedCredits)} credits`} sub={$t("usage.tabs.foldrunSModelsOnly")} />
        <Stat label={$t("usage.tabs.onYourOwnKey")} value={fmtTokens(t.totals.byokTokens)} sub={$t("usage.tabs.tokensBilledByYourProvider0")} />
      </StatGrid>
      <DataTable
        title={$t("usage.tabs.byProviderAndModel")}
        minWidth="min-w-[760px]"
        columns={[
          { label: $t("usage.tabs.provider") }, { label: $t("usage.tabs.model") }, { label: $t("usage.tabs.key") },
          { label: $t("usage.tabs.calls"), align: "right" }, { label: $t("usage.tabs.in"), align: "right" }, { label: $t("usage.tabs.cached"), align: "right" },
          { label: $t("usage.tabs.out"), align: "right" }, { label: $t("usage.tabs.billed"), align: "right" },
        ]}
        rows={t.byModel.map((r) => ({
          key: `${r.supply}:${r.provider}:${r.model}`,
          cells: [
            r.provider,
            <span key="m" className="font-mono text-[13px]">{r.model}</span>,
            <Chip key="s" tone={r.supply === "own" ? "default" : "info"}>{SUPPLY_NAMES[r.supply] ?? r.supply}</Chip>,
            r.calls,
            fmtTokens(r.inputTokens),
            <Tooltip key="c" label={$t("usage.tabs.readFromThePromptCacheWritten", { v0: String(fmtTokens(r.cacheReadTokens)), v1: String(fmtTokens(r.cacheWriteTokens)) })}>
              <span>{r.cacheReadTokens + r.cacheWriteTokens > 0 ? fmtTokens(r.cacheReadTokens + r.cacheWriteTokens) : dim}</span>
            </Tooltip>,
            fmtTokens(r.outputTokens),
            r.supply === "own" ? (
              <Tooltip key="b" label={r.billedNote ?? $t("usage.tabs.yourOwnKeyTheProviderBills")}>
                <span className="text-fg-muted">{$t("usage.tabs.0Credits")}</span>
              </Tooltip>
            ) : (
              <Tooltip key="b" label={`${r.providerCostUsd !== undefined ? $t("usage.tabs.providerPrice", { v0: String(usdExact(r.providerCostUsd)) }) : $t("usage.tabs.providerPriceMargin")}${r.estimatedCalls ? $t("usage.tabs.callSChargedAtAnEstimate", { estimatedCalls: String(r.estimatedCalls) }) : ""}`}>
                <span className="font-medium">{$t("usage.tabs.credits", { fmtCredits: fmtCredits(r.billedCredits) })}</span>
              </Tooltip>
            ),
          ],
        }))}
      />
      <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
        {u.credits?.plan?.paysForTokens ? $t("usage.tabs.tokensFromTheWallet") : $t("usage.tabs.tokensOnFoldrunSPriceWith")}
      </p>
    </>
  );
}

export function ComputeTab({ u }: { u: UsageBreakdowns }) {
  const c = u.compute;
  const used = c.meters.some((m) => (m.quantity ?? 0) > 0 || m.credits > 0);
  if (!used && !c.planFee) {
    return <EmptyState icon={<Calculator />} title={$t("usage.tabs.noComputeInThisPeriod")} description={$t("usage.tabs.sandboxTimeStorageAndNetworkShow")} />;
  }
  return (
    <>
      <DataTable
        title={$t("usage.tabs.byMeter")}
        minWidth="min-w-[640px]"
        columns={[{ label: $t("usage.tabs.meter") }, { label: $t("usage.tabs.quantity"), align: "right" }, { label: $t("usage.tabs.rate"), align: "right" }, { label: $t("usage.tabs.credits2"), align: "right" }]}
        rows={c.meters.map((m) => ({
          key: m.meter,
          cells: [
            <span key="n">
              <span className="font-medium">{METER_NAMES[m.meter] ?? m.meter}</span>
              {m.note && <span className="block max-w-xs text-xs text-fg-muted">{m.note}</span>}
            </span>,
            m.quantity === null ? dim : (
              <span key="q">
                {fmtQuantity(m.quantity)} <span className="text-fg-subtle">{m.unit}</span>
                {m.meter === "storage" && m.includedGb !== undefined && (
                  <span className="block text-xs text-fg-muted">{$t("usage.tabs.gbIncludedGbOver", { fmtQuantity: fmtQuantity(m.includedGb), fmtQuantity2: fmtQuantity(m.overGb ?? 0) })}</span>
                )}
                {m.meter === "storage" && <span className="block text-xs text-fg-muted">{$t("usage.tabs.yourFilesAndRunHistoryAs")}</span>}
                {m.sessions !== undefined && (
                  <span className="block text-xs text-fg-muted">{$t("usage.tabs.gbMoved", { sessions: m.sessions, fmtQuantity: fmtQuantity(m.networkGb ?? 0) })}</span>
                )}
              </span>
            ),
            m.rateCreditsPerUnit === null ? dim : <span key="r">{fmtCredits(m.rateCreditsPerUnit)} <span className="text-fg-subtle">{$t("usage.tabs.per", { rateUnit: rateUnit(m.meter, m.unit) })}</span></span>,
            <span key="c" className="font-medium">{fmtCredits(m.credits)}</span>,
          ],
        }))}
      />
      {c.planFee && (
        <div className="mt-4">
          <DataTable
            title={$t("usage.tabs.planFee")}
            minWidth="min-w-[480px]"
            columns={[{ label: $t("usage.tabs.line") }, { label: $t("usage.tabs.fee"), align: "right" }, { label: $t("usage.tabs.creditsItGives"), align: "right" }]}
            rows={[{ key: "fee", cells: [<span key="l" className="font-medium">{c.planFee.label}</span>, usd(c.planFee.usd), fmtCredits(c.planFee.includedCredits)] }]}
          />
        </div>
      )}
      {c.bySize.length > 0 && (
        <div className="mt-4">
          <DataTable
            title={$t("usage.tabs.byStepSize")}
            minWidth="min-w-[640px]"
            columns={[{ label: $t("usage.tabs.size") }, { label: $t("usage.tabs.steps"), align: "right" }, { label: $t("usage.tabs.hours"), align: "right" }, { label: $t("usage.tabs.reserved"), align: "right" }, { label: $t("usage.tabs.creditsPerHour"), align: "right" }]}
            rows={c.bySize.map((s) => ({
              key: s.size,
              cells: [
                <span key="s" className="font-medium">{s.size === "unrecorded" ? $t("values.size.unrecorded") : s.size}</span>,
                s.steps,
                fmtQuantity(s.hours),
                $t("usage.tabs.vcpuGibGibDisk", { v0: String(fmtQuantity(s.vcpu)), v1: String(fmtQuantity(s.memGiB)), v2: String(fmtQuantity(s.diskGiB)) }),
                s.creditsPerHour === null ? dim : fmtCredits(s.creditsPerHour),
              ],
            }))}
          />
        </div>
      )}
      <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
        {$rich("usage.tabs.computeIsPriced", { billed: u.billed ? "yes" : "no", credits: u.billed ? fmtCredits(u.billed.totalCredits) : "", strong: (chunks) => <strong className="font-medium text-fg">{chunks}</strong> })}
      </p>
    </>
  );
}

export function RatesTab({ rates, catalogue, planId }: { rates: MeterRates | null; catalogue: PricingCatalogue | null; planId: string | null }) {
  if (!rates && !catalogue) {
    return <EmptyState icon={<Coins />} title={$t("usage.tabs.nothingIsBilledHere")} description={$t("usage.tabs.thisInstallDoesNotChargeFor")} />;
  }
  return (
    <>
      {rates && (
        <DataTable
          title={$t("usage.tabs.whatYouAreCharged")}
          minWidth="min-w-[520px]"
          columns={[{ label: $t("usage.tabs.meter") }, { label: $t("usage.tabs.rate"), align: "right" }, { label: $t("usage.tabs.inCredits"), align: "right" }]}
          rows={[
            ["vCPU", rates.vcpuUsdPerHour, "per vCPU-hour"],
            ["RAM", rates.ramUsdPerGibHour, "per GiB-hour"],
            ["Step disk", rates.diskUsdPerGibMonth, "per GiB-month"],
            [$t("usage.tabs.storageOverYourPlanSAllowance"), rates.storageUsdPerGbMonth, "per GB-month"],
            [$t("usage.tabs.networkInAndOut"), rates.networkUsdPerGb, "per GB"],
          ].map(([name, rate, per]) => ({
            key: String(name),
            cells: [name, <span key="r">{usdExact(rate as number)} <span className="text-fg-subtle">{per}</span></span>, fmtCredits((rate as number) / rates.creditUsd)],
          }))}
        />
      )}
      {catalogue && (
        <div className="mt-4">
          {/* The one subscription's sizes, as Billing → Plan sells them (27 Nov 2026): the same catalogue, every figure the console's. */}
          <DataTable
            title={$t("usage.tabs.subscriptionSizes")}
            minWidth="min-w-[560px]"
            columns={[{ label: $t("usage.tabs.plan") }, { label: $t("usage.tabs.price"), align: "right" }, { label: $t("usage.tabs.modelAWeek"), align: "right" }, { label: $t("usage.tabs.modelAMonth"), align: "right" }]}
            rows={(catalogue.subscriptions ?? []).map((p) => ({
              key: p.id,
              cells: [
                <span key="n" className="font-medium">{p.name}{p.id === planId && <Chip tone="good" className="ms-2">{$t("usage.tabs.yours")}</Chip>}</span>,
                $t("usage.tabs.per30Days", { usd: usd(p.priceUsd) }),
                p.model.weekUsd === null ? $t("usage.tabs.notLimited") : usd(p.model.weekUsd),
                p.model.monthUsd === null ? $t("usage.tabs.notLimited") : usd(p.model.monthUsd),
              ],
            }))}
          />
        </div>
      )}
      {catalogue && (
        <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
          {$t("usage.tabs.aDefaultStepVcpuGibCosts", { vcpu: String(catalogue.example.vcpu), memGiB: String(catalogue.example.memGiB), fmtCredits: fmtCredits(catalogue.example.creditsPerHour) })}
        </p>
      )}
      {catalogue && catalogue.models.prices.length > 0 && (
        <div className="mt-4">
          <DataTable
            title={$t("usage.tabs.tokensOnFoldrunSModelsProvider", { margin: String(catalogue.models.margin) })}
            minWidth="min-w-[640px]"
            columns={[{ label: $t("usage.tabs.provider") }, { label: $t("usage.tabs.model") }, { label: $t("usage.tabs.input1m"), align: "right" }, { label: $t("usage.tabs.output1m"), align: "right" }, { label: $t("usage.tabs.cacheRead1m"), align: "right" }]}
            rows={catalogue.models.prices.map((m) => ({
              key: `${m.provider}:${m.model}`,
              cells: [m.provider, <span key="m" className="font-mono text-[13px]">{m.model}</span>, usd(m.inputPerMTok), usd(m.outputPerMTok), m.cacheReadPerMTok === null ? dim : usd(m.cacheReadPerMTok)],
            }))}
          />
        </div>
      )}
      {catalogue && catalogue.models.soon.length > 0 && (
        <Callout tone="info" className="mt-4">{$t("usage.tabs.comingToFoldrunSModels", { join: catalogue.models.soon.join(", ") })}</Callout>
      )}
    </>
  );
}
