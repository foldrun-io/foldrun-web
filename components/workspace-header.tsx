// The way up, from inside a workspace. One line: the workspace's name,
// linking to its overview. The page's own title comes from PageHeader below
// it — this existed six times as a copied header block whose breadcrumb
// pointed at the account's workspace list, which stopped being these pages'
// parent the day the app went workspace-first.
//
// The right side is the money, the way every metered SaaS shows it where
// you work rather than only on a billing page: what THIS workspace has
// spent this month, and what the ACCOUNT has left. Spend is the
// workspace's; the balance is shared — the wording keeps them straight,
// and the whole line is a door to the wallet.

import Link from "next/link";
import { billing } from "@/platform/billing";
import { platform } from "@/lib/platform";
import { workspaceBudgetStanding } from "@/platform/limits";

export async function WorkspaceHeader({ workspace, qs }: { workspace: string; qs: string }) {
  const tenant = new URLSearchParams(qs.replace(/^\?/, "")).get("tenant") ?? "default";
  const hosted = platform.edition() === "hosted";
  // Spend in the cap's OWN window — today's for a daily cap, the month's
  // when there is no cap — so the figure and the cap beside it agree.
  const { budget, spentUsd: spent, window } = await workspaceBudgetStanding(tenant, workspace);
  const balance = hosted ? await billing().balanceUsd(tenant) : 0;
  // Amber from 80%: the point of showing a cap is hearing about it before
  // the gate refuses a scheduled run, not after.
  const nearCap = budget !== null && spent >= budget.usd * 0.8;
  return (
    <header className="mb-6 flex items-center justify-between gap-3 [.mb-4>&]:mb-0">
      <Link
        href={`/dashboard/${workspace}${qs}`}
        className="text-sm font-medium text-fg-subtle hover:text-fg-tertiary"
      >
        ← {workspace}
      </Link>
      {/* The spend line is every edition's: a self-hoster pays their own
          model bill and a `budget:` cap is theirs to set. Where it LEADS is
          the edition's — the wallet where money is added, usage where it
          is only counted. */}
      <Link
        href={hosted ? `/dashboard/wallet${qs}` : `/dashboard/usage${qs}`}
        title={
          hosted
            ? `This workspace's spend ${window} (against its budget: cap when one is set) · the account's remaining credits. Open the wallet.`
            : `This workspace's spend ${window} (against its budget: cap when one is set). Open usage.`
        }
        className={`text-xs tabular-nums transition-colors ${
          nearCap ? "font-medium text-amber-600 hover:text-amber-700" : "text-fg-subtle hover:text-fg-secondary"
        }`}
      >
        ${spent.toFixed(2)}
        {budget !== null && <> of ${budget.usd.toFixed(0)}</>} {window}
        {hosted && <> · ${balance.toFixed(2)} left</>}
      </Link>
    </header>
  );
}
