// End customers (FOL-168): the account's own users' limits and its block list.
//
//   GET                                   { limits, defaults, blocked: [{ customer, by, reason, at }] }
//   PATCH { startsPerMinute?, gatewayRpm?, gatewayConcurrency? }   change the limits per customer (null: the default)
//
// Limits apply only to runs and gateway calls that name a customer. Changing
// them is an admin's over every workspace: they hold the whole account.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requirePermission, errorResponse, ApiError } from "@/server/api";
import { customerLimits, setCustomerLimits, listBlocked, limitsProblem, CUSTOMER_DEFAULTS } from "@/platform/customers";
import { audit } from "@/server/audit";

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireCaller(req);
    return NextResponse.json({ limits: await customerLimits(tenant), defaults: CUSTOMER_DEFAULTS, blocked: await listBlocked(tenant) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    if (actor.workspaces !== null) throw new ApiError("customer limits hold the whole account — they need access to every workspace", 403);
    const body = (await req.json().catch(() => null)) as unknown;
    const problem = limitsProblem(body);
    if (problem) throw new ApiError(problem, 400);
    const limits = await setCustomerLimits(tenant, body as Record<string, number | null>, actor.name);
    await audit("customer.limits", { actor: actor.name, tenant, detail: { set: body as Record<string, unknown> } });
    return NextResponse.json({ limits, defaults: CUSTOMER_DEFAULTS });
  } catch (err) {
    return errorResponse(err);
  }
}
