// What each desk and each agent has actually cost, week by week.
//
// The Usage page next door reads the run records, which is right for step
// counts and pod seconds and wrong for money over time: run records are
// pruned, so a desk's cost history disappears exactly when it becomes
// interesting, and a record holds what a run consumed rather than what it
// was charged. This reads the ledger, which is append-only and holds the
// real number.
//
// ?days=56 sets the window. Over three weeks it buckets by week, because a
// hundred daily columns is a table nobody reads. A caller scoped to some
// workspaces sees the charges in those.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { intParam } from "@/server/query";
import { spendHistory } from "@/platform/usage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const days = intParam(req.nextUrl.searchParams.get("days"), 56, 1, 365);
    return NextResponse.json(await spendHistory(tenant, days, { workspaces: actor.workspaces }));
  } catch (err) {
    return errorResponse(err);
  }
}
