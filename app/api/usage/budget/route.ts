// Spend against the caps, at every level the Spend limits page shows: the
// account's own budget: and each workspace's — the cap (over a day, a week or
// a month), what is spent in THAT window, and the window's name. The same
// figures the page renders and the budget gate refuses at (platform
// limits.ts accountBudgetStanding / workspaceBudgetStanding), so a terminal
// and the page cannot disagree about how close a cap is.
//
// A member or key scoped to some workspaces sees those workspaces. The
// account's figure is spend summed over every workspace, so to them it is
// `account: null` and `accountHidden: true` — the line /api/usage draws.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { accountBudgetStanding, workspaceBudgetStanding, type BudgetStanding } from "@/platform/limits";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces } from "@/lib/store";

export const dynamic = "force-dynamic";

const view = (s: BudgetStanding) => ({ budget: s.budget, label: s.label, spentUsd: s.spentUsd, window: s.window });

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const names = listWorkspaces(tenant).map((w) => w.name).filter((n) => scopeAllows(actor.workspaces, n));
    const workspaces = await Promise.all(names.map(async (workspace) => ({ workspace, ...view(await workspaceBudgetStanding(tenant, workspace)) })));
    // Most spent first, as the page lists them.
    workspaces.sort((a, b) => b.spentUsd - a.spentUsd || a.workspace.localeCompare(b.workspace));
    const wide = actor.workspaces === null;
    return NextResponse.json({
      account: wide ? view(await accountBudgetStanding(tenant)) : null,
      ...(wide ? {} : { accountHidden: true }),
      workspaces,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
