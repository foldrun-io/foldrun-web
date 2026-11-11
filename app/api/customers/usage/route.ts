// What each end customer's calls on foldrun's models were charged (FOL-168):
//
//   GET ?days=7   { days, customers: [{ customer, chargedUsd, todayUsd, calls }] }
//
// Newest-spending first, at most 500; charged dollars (each call at the
// margin it was held at), open estimates included; today is UTC. Calls that
// named no customer are not here. Anyone in the account may read it.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { intParam } from "@/server/query";
import { spendByCustomer } from "@/platform/model-usage";
import { chargeMargin } from "@/platform/model-gateway";

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireCaller(req);
    const days = intParam(req.nextUrl.searchParams.get("days"), 7, 1, 90);
    return NextResponse.json({ days, customers: await spendByCustomer(tenant, days, chargeMargin()) });
  } catch (err) {
    return errorResponse(err);
  }
}
