// Proposed fixes in one workspace (platform improve.ts), newest first.
//
//   GET ?status=ready&eval=<name> → { proposals }
//
// A proposal still drafting is settled as it is read — its job's result
// copied in, or failed when the draft ended in an error or never finished —
// so this answers what the proposal is now, not what the last pass saw.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import { listProposals, settleProposal, type ProposalStatus } from "@/platform/improve";

const STATUSES: ProposalStatus[] = ["drafting", "ready", "failed", "applying", "applied", "partial", "dismissed"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    const status = req.nextUrl.searchParams.get("status");
    const evalName = req.nextUrl.searchParams.get("eval");
    if (status && !STATUSES.includes(status as ProposalStatus)) throw new ApiError(`status is one of ${STATUSES.join(", ")}`, 400);
    const proposals = await Promise.all((await listProposals(tenant, workspace)).map((p) => settleProposal(tenant, p)));
    return NextResponse.json({
      proposals: proposals.filter((p) => (!status || p.status === status) && (!evalName || p.eval === evalName)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
