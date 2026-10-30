// One proposed fix (platform improve.ts): read it, apply it, or dismiss it.
//
//   GET                         → the proposal (settled if it was drafting)
//   POST { action: "apply" }    → writes its files, each as a revision by the
//                                 caller — 409 when one changed since it was
//                                 drawn up, 422 when one cannot be written
//   POST { action: "dismiss" }  → set aside; its failures stay looked at
//
// Applying and dismissing need workspace:write: applying writes the files a
// save would, and nothing else.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requirePermission, errorResponse, ApiError, actorOf } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { getProposal, settleProposal, applyProposal, dismissProposal, isProposalId } from "@/platform/improve";
import { requireWorkspace } from "@/lib/storage";
import { jsonObject } from "@/server/body";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; id: string }> }) {
  try {
    const { workspace, id } = await ctx.params;
    const tenant = await requireTenant(req);
    // A name with no workspace is a 404 as on its siblings (30 Oct 2026),
    // not an empty answer that reads as "nothing here".
    requireWorkspace(tenant, workspace);
    if (!isProposalId(id)) throw new ApiError(`not a proposal id: ${id}`, 400);
    const p = await getProposal(tenant, workspace, id);
    if (!p) throw new ApiError(`no proposal ${id} in ${workspace}`, 404);
    return NextResponse.json(await settleProposal(tenant, p));
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; id: string }> }) {
  try {
    const { workspace, id } = await ctx.params;
    const { tenant } = await requirePermission(req, "workspace:write");
    requireWorkspace(tenant, workspace);
    if (!isProposalId(id)) throw new ApiError(`not a proposal id: ${id}`, 400);
    // An object, or 400: a `null` body used to be a TypeError, a 500.
    const body = await jsonObject(req, { optional: true });
    const by = await actorOf(req);
    if (body.action === "apply") return NextResponse.json(await applyProposal(tenant, workspace, id, by));
    if (body.action === "dismiss") return NextResponse.json(await dismissProposal(tenant, workspace, id, by));
    throw new ApiError('expected { action: "apply" | "dismiss" }', 400);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
