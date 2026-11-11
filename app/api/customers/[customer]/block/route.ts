// Block or unblock one end customer (FOL-168).
//
//   PUT    { reason? }   block it: its runs are refused at start and at their next model call, its gateway calls likewise
//   DELETE               unblock it (404 when it was not blocked)
//
// An admin's over every workspace. Audited as customer.blocked / customer.unblocked.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, ApiError, refuse } from "@/server/api";
import { blockCustomer, unblockCustomer } from "@/platform/customers";
import { customerProblem } from "@/lib/customer";
import { audit } from "@/server/audit";

async function admin(req: NextRequest, ctx: { params: Promise<{ customer: string }> }) {
  const { tenant, actor } = await requirePermission(req, "workspace:manage");
  if (actor.workspaces !== null) throw new ApiError("blocking a customer holds the whole account — it needs access to every workspace", 403);
  const { customer } = await ctx.params;
  const problem = customerProblem(customer);
  if (problem) throw new ApiError(problem, 400);
  return { tenant, actor, customer };
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ customer: string }> }) {
  try {
    const { tenant, actor, customer } = await admin(req, ctx);
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body?.reason === "string" ? body.reason : null;
    await blockCustomer(tenant, customer, actor.name, reason);
    await audit("customer.blocked", { actor: actor.name, tenant, subject: customer, ...(reason ? { detail: { reason: reason.slice(0, 500) } } : {}) });
    return NextResponse.json({ ok: true, customer, blocked: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ customer: string }> }) {
  try {
    const { tenant, actor, customer } = await admin(req, ctx);
    if (!(await unblockCustomer(tenant, customer))) return refuse(`customer ${customer} is not blocked`, 404);
    await audit("customer.unblocked", { actor: actor.name, tenant, subject: customer });
    return NextResponse.json({ ok: true, customer, blocked: false });
  } catch (err) {
    return errorResponse(err);
  }
}
