// Spend limits, beside the money they limit: each cap, how far into its
// window the spend is, and where the warnings sit — editable in place. A
// cap is over a day, a week or a month; unset is no limit.

import fs from "node:fs";
import Link from "next/link";
import { accountDir, listWorkspaces, workspaceDir } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { accountBudgetStanding, workspaceBudgetStanding, type BudgetStanding } from "@/platform/limits";
import { PageHeader, Card } from "@/components/ui";
import { Meter } from "@/components/data";
import { BudgetCard } from "@/components/defaults-cards";
import { usd } from "@/components/money";
import { viewerScope } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { BillingTabs } from "@/components/billing-tabs";
import { platform } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Spend limits" };

/** One cap: the bar, the sentence under it, the form beside it. */
function CapRow({ title, note, standing, endpoint, tenant }: { title: string; note?: string; standing: BudgetStanding; endpoint: string; tenant: string }) {
  const { budget: cap, spentUsd: spent, window, label } = standing;
  const pct = cap ? Math.min(100, (spent / cap.usd) * 100) : 0;
  const turns = cap?.period === "day" ? "tomorrow" : cap?.period === "week" ? "next week" : "the new month";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-[14rem] flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {note && <p className="mt-0.5 text-xs text-fg-muted">{note}</p>}
        {/* Only a real cap gets a line here. Saying "no limit" beside a box
            whose own placeholder reads "no limit" is the same fact twice,
            and it was the bulk of this page's height. */}
        {cap && (
          <div className="mt-2 max-w-md">
            <Meter fraction={spent / cap.usd} marks={[80, 95]} tone={pct >= 95 ? "error" : pct >= 80 ? "warn" : undefined} />
            <p className="mt-1 text-xs text-fg-muted">
              {usd(spent)} of {label} {window} · {Math.round(pct)}%
              {pct >= 100 ? ` · at the cap, new runs are refused until ${turns}` : pct >= 80 ? " · a warning has been sent" : " · warnings at 80% and 95%"}
            </p>
          </div>
        )}
        {!cap && spent > 0 && <p className="mt-1 text-xs text-fg-subtle">{usd(spent)} spent this month</p>}
      </div>
      <BudgetCard endpoint={endpoint} tenant={tenant} initial={cap} spent={spent} compact />
    </div>
  );
}

export default async function LimitsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(accountDir(tenant))) return <main className="mx-auto max-w-7xl px-6 py-8">Unknown account.</main>;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const scope = await viewerScope();
  const account = await accountBudgetStanding(tenant);
  const workspaces = await Promise.all(
    listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map(async (w) => ({ name: w.name, standing: await workspaceBudgetStanding(tenant, w.name) })),
  );
  const accountNotify = Boolean(readAgentsMdKeys(accountDir(tenant)).notify);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title="Billing" subtitle="How much may be spent in a day, a week or a month before runs stop starting — and where the warnings sit. Unset is no limit." />
      <BillingTabs current="limits" tenant={tenant} hosted={platform.edition() === "hosted"} />
      <Card className="mb-4">
        <CapRow title="Whole account" note="Across every workspace. At the cap, everything stops starting until the window turns." standing={account} endpoint="/api/account" tenant={tenant} />
        {!accountNotify && (
          <p className="border-t border-line-faint px-5 py-3 text-xs text-amber-700">
            Warnings have nowhere to go: the account has no notify: destination. <Link href={`/dashboard/settings${qs}`} className="underline">Set one</Link>.
          </p>
        )}
      </Card>
      <Card>
        <p className="border-b border-line-faint px-5 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Per workspace</p>
        {workspaces.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-fg-muted">No workspaces yet.</p>
        ) : (
          <div className="divide-y divide-line-faint">
            {workspaces.sort((a, b) => b.standing.spentUsd - a.standing.spentUsd).map((w) => (
              <CapRow key={w.name} title={w.name} standing={w.standing} endpoint={`/api/workspaces/${encodeURIComponent(w.name)}`} tenant={tenant} />
            ))}
          </div>
        )}
      </Card>
      <p className="mt-4 text-xs text-fg-subtle">Every cap here is the <code className="font-mono">budget:</code> line in that workspace&apos;s <code className="font-mono">AGENTS.md</code>, editable in either place. A flow can also carry its own per-run <code className="font-mono">budget:</code>, and so can an agent — the most it may spend in one run. Both are hard caps that stop a step mid-turn, and both live in their own files.</p>
    </main>
  );
}
