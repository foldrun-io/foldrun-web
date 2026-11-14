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
    // ?from=YYYY-MM-DD&to=YYYY-MM-DD bound the tokens, compute and billed
    // blocks (default: the month so far); a bad day is a plain Error, so a 400.
    const q = new URL(req.url).searchParams;
    // Through versionedJson: the 2026-10-26 change withdrew two ledger fields.
    return versionedJson(req, await accountUsage(tenant, { workspaces: actor.workspaces, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }));
  } catch (err) {
    return errorResponse(err);
  }
}
