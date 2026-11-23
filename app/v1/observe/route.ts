// The account Observe page's analysis as JSON (`foldrun observe`): the window
// against the one before it, why runs went wrong, desks worst first, each day,
// and the agents and tools to watch — server/account-observe.ts, the function
// the page renders from. A caller scoped to some workspaces sees theirs.
// ?days= 1–365, 7 unasked (the page's default).

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { intParam } from "@/server/query";
import { accountObservation, observationJson } from "@/server/account-observe";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const days = intParam(req.nextUrl.searchParams.get("days"), 7, 1, 365);
    return NextResponse.json(observationJson(await accountObservation(tenant, actor.workspaces, days)));
  } catch (err) {
    return errorResponse(err);
  }
}
