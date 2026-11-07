// The Usage page's Tokens, Compute and Rates tabs and the credits block
// (FOL-125). Server components over what GET /api/usage and GET /api/usage/rates
// answer: the page and the API read the same function, so they cannot differ.

import { Calculator, Coins } from "lucide-react";
import { Callout, Chip, EmptyState, SectionTitle, Stat, StatGrid } from "@/components/kit/page";
import { DataTable } from "@/components/kit/table";
import { Tooltip } from "@/components/kit/tooltip";
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
      <SectionTitle title="Your credits" description="One credit is one cent. Two pots, spent in this order: plan credits first on compute, storage and network; bought credits for tokens on foldrun's models." />
      <StatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <Stat
          label="Plan credits"
          value={credits(c.pots.planUsd)}
          sub={plan ? `${plan.name} · ${fmtCredits(plan.creditsPerMonth)} credits a month` : "No plan"}
        />
        <Stat
          label="Bought credits"
          value={credits(c.pots.boughtUsd)}
          sub={c.boughtOldestExpiresAt ? <>The oldest expires <LocalTime iso={c.boughtOldestExpiresAt} /></> : "Top-ups last 12 months"}
        />
        <Stat
          label="Plan"
          value={plan?.name ?? "—"}
          sub={plan ? (plan.rollover ? `Unused credits roll over, up to ${fmtCredits(plan.rolloverCapCredits)}` : "Unused credits are lost at month end") : undefined}
        />
      </StatGrid>
      {plan?.resetsAt && (
        <p className="mt-2 px-1 text-xs text-fg-muted">
          {plan.rollover ? "The plan renews" : "Plan credits reset"} <LocalTime iso={plan.resetsAt} />.
        </p>
      )}
    </section>
  );
}

export function TokensTab({ u }: { u: UsageBreakdowns }) {
  const t = u.tokens;
  if (t.byModel.length === 0) {
    return <EmptyState icon={<Coins />} title="No model calls in this period" description="Calls show here by provider and model once a run has used one. Pick another period above to look further back." />;
  }
  return (
    <>
      <StatGrid className="mb-8 md:grid-cols-3 xl:grid-cols-3">
        <Stat label="Model calls" value={t.totals.calls} />
        <Stat label="Billed" value={`${fmtCredits(t.totals.billedCredits)} credits`} sub="foldrun's models only" />
        <Stat label="On your own key" value={fmtTokens(t.totals.byokTokens)} sub="Tokens billed by your provider, 0 credits here" />
      </StatGrid>
      <DataTable
        title="By provider and model"
        minWidth="min-w-[760px]"
        columns={[
          { label: "Provider" }, { label: "Model" }, { label: "Key" },
          { label: "Calls", align: "right" }, { label: "In", align: "right" }, { label: "Cached", align: "right" },
          { label: "Out", align: "right" }, { label: "Billed", align: "right" },
        ]}
        rows={t.byModel.map((r) => ({
          key: `${r.supply}:${r.provider}:${r.model}`,
          cells: [
            r.provider,
            <span key="m" className="font-mono text-[13px]">{r.model}</span>,
            <Chip key="s" tone={r.supply === "own" ? "default" : "info"}>{SUPPLY_NAMES[r.supply] ?? r.supply}</Chip>,
            r.calls,
            fmtTokens(r.inputTokens),
            <Tooltip key="c" label={`${fmtTokens(r.cacheReadTokens)} read from the prompt cache, ${fmtTokens(r.cacheWriteTokens)} written to it`}>
              <span>{r.cacheReadTokens + r.cacheWriteTokens > 0 ? fmtTokens(r.cacheReadTokens + r.cacheWriteTokens) : dim}</span>
            </Tooltip>,
            fmtTokens(r.outputTokens),
            r.supply === "own" ? (
              <Tooltip key="b" label={r.billedNote ?? "your own key; the provider bills you"}>
                <span className="text-fg-muted">0 credits</span>
              </Tooltip>
            ) : (
              <Tooltip key="b" label={`${r.providerCostUsd !== undefined ? `provider price ${usdExact(r.providerCostUsd)}` : "provider price × margin"}${r.estimatedCalls ? ` · ${r.estimatedCalls} call(s) charged at an estimate, no usage came back` : ""}`}>
                <span className="font-medium">{fmtCredits(r.billedCredits)} credits</span>
              </Tooltip>
            ),
          ],
        }))}
      />
      <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
        Tokens on foldrun&apos;s models are the provider&apos;s price with the platform&apos;s margin, paid from bought credits only. On your own key the
        provider bills you directly; the rows are here so you can see what was used.
      </p>
    </>
  );
}

export function ComputeTab({ u }: { u: UsageBreakdowns }) {
  const c = u.compute;
  const used = c.meters.some((m) => (m.quantity ?? 0) > 0 || m.credits > 0);
  if (!used && !c.planFee) {
    return <EmptyState icon={<Calculator />} title="No compute in this period" description="Sandbox time, storage and network show here by meter once a run has used them." />;
  }
  return (
    <>
      <DataTable
        title="By meter"
        minWidth="min-w-[640px]"
        columns={[{ label: "Meter" }, { label: "Quantity", align: "right" }, { label: "Rate", align: "right" }, { label: "Credits", align: "right" }]}
        rows={c.meters.map((m) => ({
          key: m.meter,
          cells: [
            <span key="n" className="font-medium">{METER_NAMES[m.meter] ?? m.meter}</span>,
            m.quantity === null ? dim : (
              <span key="q">
                {fmtQuantity(m.quantity)} <span className="text-fg-subtle">{m.unit}</span>
                {m.meter === "storage" && m.includedGb !== undefined && (
                  <span className="block text-xs text-fg-muted">{fmtQuantity(m.includedGb)} GB included · {fmtQuantity(m.overGb ?? 0)} GB over</span>
                )}
              </span>
            ),
            m.rateCreditsPerUnit === null ? dim : <span key="r">{fmtCredits(m.rateCreditsPerUnit)} <span className="text-fg-subtle">per {rateUnit(m.meter, m.unit)}</span></span>,
            <span key="c" className="font-medium">{fmtCredits(m.credits)}</span>,
          ],
        }))}
      />
      {c.planFee && (
        <div className="mt-4">
          <DataTable
            title="Plan fee"
            minWidth="min-w-[480px]"
            columns={[{ label: "Line" }, { label: "Fee", align: "right" }, { label: "Credits it gives", align: "right" }]}
            rows={[{ key: "fee", cells: [<span key="l" className="font-medium">{c.planFee.label}</span>, usd(c.planFee.usd), fmtCredits(c.planFee.includedCredits)] }]}
          />
        </div>
      )}
      {c.bySize.length > 0 && (
        <div className="mt-4">
          <DataTable
            title="By step size"
            minWidth="min-w-[640px]"
            columns={[{ label: "Size" }, { label: "Steps", align: "right" }, { label: "Hours", align: "right" }, { label: "Reserved", align: "right" }, { label: "Credits per hour", align: "right" }]}
            rows={c.bySize.map((s) => ({
              key: s.size,
              cells: [
                <span key="s" className="font-medium">{s.size}</span>,
                s.steps,
                fmtQuantity(s.hours),
                `${fmtQuantity(s.vcpu)} vCPU · ${fmtQuantity(s.memGiB)} GiB · ${fmtQuantity(s.diskGiB)} GiB disk`,
                s.creditsPerHour === null ? dim : fmtCredits(s.creditsPerHour),
              ],
            }))}
          />
        </div>
      )}
      <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
        Compute is priced on what a step reserves, per second, not on what it touched. Quantities are at today&apos;s rates; the ledger&apos;s
        total for the period is {u.billed ? <strong className="font-medium text-fg">{fmtCredits(u.billed.totalCredits)} credits</strong> : "not shown to a member limited to some workspaces"}.
      </p>
    </>
  );
}

export function RatesTab({ rates, catalogue, planId }: { rates: MeterRates | null; catalogue: PricingCatalogue | null; planId: string | null }) {
  if (!rates && !catalogue) {
    return <EmptyState icon={<Coins />} title="Nothing is billed here" description="This install does not charge for sandbox time, storage or network, so there are no rates to show." />;
  }
  return (
    <>
      {rates && (
        <DataTable
          title="What you are charged"
          minWidth="min-w-[520px]"
          columns={[{ label: "Meter" }, { label: "Rate", align: "right" }, { label: "In credits", align: "right" }]}
          rows={[
            ["vCPU", rates.vcpuUsdPerHour, "per vCPU-hour"],
            ["RAM", rates.ramUsdPerGibHour, "per GiB-hour"],
            ["Step disk", rates.diskUsdPerGibMonth, "per GiB-month"],
            ["Storage over your plan's allowance", rates.storageUsdPerGbMonth, "per GB-month"],
            ["Network, in and out", rates.networkUsdPerGb, "per GB"],
          ].map(([name, rate, per]) => ({
            key: String(name),
            cells: [name, <span key="r">{usdExact(rate as number)} <span className="text-fg-subtle">{per}</span></span>, fmtCredits((rate as number) / rates.creditUsd)],
          }))}
        />
      )}
      {catalogue && (
        <div className="mt-4">
          <DataTable
            title="Plans"
            minWidth="min-w-[720px]"
            columns={[{ label: "Plan" }, { label: "Price", align: "right" }, { label: "Credits a month", align: "right" }, { label: "Storage", align: "right" }, { label: "Compute at once", align: "right" }, { label: "Queue" }]}
            rows={catalogue.plans.map((p) => ({
              key: p.id,
              cells: [
                <span key="n" className="font-medium">{p.name}{p.id === planId && <Chip tone="good" className="ml-2">yours</Chip>}</span>,
                p.feeUsd === 0 ? "Free" : `${usd(p.feeUsd)}/month`,
                p.creditsPerMonth,
                `${p.storageGb} GB`,
                `${p.computeAtOnce.vcpu} vCPU · ${p.computeAtOnce.memGiB} GiB`,
                p.lane === "fast" ? "fast" : "normal",
              ],
            }))}
          />
        </div>
      )}
      {catalogue && (
        <p className="mt-3 max-w-3xl px-1 text-sm leading-relaxed text-fg-muted">
          A default step ({catalogue.example.vcpu} vCPU, {catalogue.example.memGiB} GiB) costs about {fmtCredits(catalogue.example.creditsPerHour)} credits an hour.
          Plan credits roll over up to twice the monthly amount on paid plans and are lost at month end on Free. They never pay for tokens on foldrun&apos;s
          models; bought credits do.
        </p>
      )}
      {catalogue && catalogue.models.prices.length > 0 && (
        <div className="mt-4">
          <DataTable
            title={`Tokens on foldrun's models (provider price × ${catalogue.models.margin})`}
            minWidth="min-w-[640px]"
            columns={[{ label: "Provider" }, { label: "Model" }, { label: "Input / 1M", align: "right" }, { label: "Output / 1M", align: "right" }, { label: "Cache read / 1M", align: "right" }]}
            rows={catalogue.models.prices.map((m) => ({
              key: `${m.provider}:${m.model}`,
              cells: [m.provider, <span key="m" className="font-mono text-[13px]">{m.model}</span>, usd(m.inputPerMTok), usd(m.outputPerMTok), m.cacheReadPerMTok === null ? dim : usd(m.cacheReadPerMTok)],
            }))}
          />
        </div>
      )}
      {catalogue && catalogue.models.soon.length > 0 && (
        <Callout tone="info" className="mt-4">Coming to foldrun&apos;s models: {catalogue.models.soon.join(", ")}.</Callout>
      )}
    </>
  );
}
