// Recurring problems found in the runs, with evidence and what they cost
// (FOL-72 step 8) — core insights.ts.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { intParam } from "@/server/query";
import { cachedAccountInsights } from "@/server/insights";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const q = req.nextUrl.searchParams;
    const days = intParam(q.get("days"), 7, 1, 30);
    return NextResponse.json({ days, insights: cachedAccountInsights(tenant, actor.workspaces, days, q.get("workspace")) });
  } catch (err) {
    return errorResponse(err);
  }
}
