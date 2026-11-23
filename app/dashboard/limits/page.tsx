// Spend limits, beside the money they limit: each cap, how far into its
// window the spend is, and where the warnings sit — editable in place. A
// cap is over a day, a week or a month; unset is no limit.

import { $rich, $t } from "@/i18n";
import fs from "node:fs";
import Link from "@foldrun/ui/react/link";
import { accountDir, listWorkspaces } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { accountBudgetStanding, workspaceBudgetStanding, type BudgetStanding } from "@/platform/limits";
import { Page, PageHeader, Panel, EmptyState } from "@foldrun/ui/react/page";
import { Wallet } from "lucide-react";
import { Meter } from "@foldrun/ui/react/chart";
import { BudgetCard } from "@/components/defaults-cards";
import { usd } from "@/components/money";
import { viewerScope } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { BillingTabs } from "@/components/billing-tabs";
import { platform } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const metadata = { title: $t("limits.page.billingSpendLimits") };

/** One cap: the bar, the sentence under it, the form beside it. */
function CapRow({ title, note, standing, endpoint, tenant }: { title: string; note?: string; standing: BudgetStanding; endpoint: string; tenant: string }) {
  const { budget: cap, spentUsd: spent, window, label } = standing;
  const pct = cap ? Math.min(100, (spent / cap.usd) * 100) : 0;
  const turns = cap?.period === "day" ? "tomorrow" : cap?.period === "week" ? $t("limits.page.nextWeek") : $t("limits.page.theNewMonth");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium text-fg">{title}</p>
        {note && <p className="mt-0.5 text-sm text-fg-muted">{note}</p>}
        {/* Only a real cap gets a line here. Saying "no limit" beside a box
            whose own placeholder reads "no limit" is the same fact twice,
            and it was the bulk of this page's height. */}
        {cap && (
          <div className="mt-2 max-w-md">
            <Meter fraction={spent / cap.usd} marks={[80, 95]} tone={pct >= 95 ? "error" : pct >= 80 ? "warn" : undefined} />
            <p className="mt-1.5 text-xs text-fg-muted">
              {$t("limits.page.of", { spent: usd(spent), label: label ?? "", window: window, pct: String(Math.round(pct)) })}
              {pct >= 100 ? $t("limits.page.atTheCapNewRunsAre", { turns: String(turns) }) : pct >= 80 ? $t("limits.page.aWarningHasBeenSent") : $t("limits.page.warningsAt80And95")}
            </p>
          </div>
        )}
        {!cap && spent > 0 && <p className="mt-1 text-sm text-fg-muted">{$t("limits.page.spentThisMonth", { spent: usd(spent) })}</p>}
      </div>
      <BudgetCard endpoint={endpoint} tenant={tenant} initial={cap} spent={spent} compact />
    </div>
  );
}

export default async function LimitsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(accountDir(tenant))) return (
      <Page>
        <EmptyState icon={<Wallet />} title={$t("limits.page.unknownAccount")} />
      </Page>
    );
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const scope = await viewerScope();
  const account = await accountBudgetStanding(tenant);
  const workspaces = await Promise.all(
    listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map(async (w) => ({ name: w.name, standing: await workspaceBudgetStanding(tenant, w.name) })),
  );
  const accountNotify = Boolean(readAgentsMdKeys(accountDir(tenant)).notify);

  return (
    <Page className="pb-16">
      <PageHeader title={platform.edition() === "hosted" ? $t("limits.page.billing") : $t("limits.page.usage")} description={$t("limits.page.howMuchMayBeSpentIn")} />
      <BillingTabs current="limits" tenant={tenant} hosted={platform.edition() === "hosted"} />
      <div className="space-y-8">
        <Panel title={$t("limits.page.wholeAccount")} description={$t("limits.page.acrossEveryWorkspaceAtTheCap")} flush>
          <CapRow title={$t("limits.page.accountCap")} standing={account} endpoint="/v1/account" tenant={tenant} />
          {!accountNotify && (
            <p className="border-t border-line bg-warning-soft px-5 py-3 text-sm text-warning">
              {$rich("limits.page.warningsHaveNowhereToGoThe", { link: (chunks) => <Link href={`/dashboard/settings?tab=policies${qs.replace("?", "&")}#observability`} className="font-medium underline underline-offset-2">{chunks}</Link> })}
            </p>
          )}
        </Panel>
        <Panel title={$t("limits.page.perWorkspace")} flush>
          {workspaces.length === 0 ? (
            <EmptyState bare compact icon={<Wallet />} title={$t("limits.page.noWorkspaceYet")} />
          ) : (
            <div className="divide-y divide-line">
              {workspaces
                .sort((a, b) => b.standing.spentUsd - a.standing.spentUsd)
                .map((w) => (
                  <CapRow key={w.name} title={w.name} standing={w.standing} endpoint={`/v1/workspaces/${encodeURIComponent(w.name)}`} tenant={tenant} />
                ))}
            </div>
          )}
        </Panel>
        <p className="max-w-3xl px-1 text-sm text-fg-muted">
          {$rich("limits.page.everyCapHereIsTheBudget", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </p>
      </div>
    </Page>
  );
}
