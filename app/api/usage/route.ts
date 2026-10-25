// The account's consumption as one JSON document — the same aggregation the
// Usage page renders, for anyone who wants it in a spreadsheet instead. A
// member or key scoped to some workspaces sees those, and totals over them.

import { NextRequest } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { versionedJson } from "@/server/api-version";
import { accountUsage } from "@/platform/usage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // Through versionedJson: the 2026-10-26 change withdrew two ledger fields.
    return versionedJson(req, await accountUsage(tenant, { workspaces: actor.workspaces }));
  } catch (err) {
    return errorResponse(err);
  }
}
