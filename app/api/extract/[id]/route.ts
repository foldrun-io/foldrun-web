import { NextRequest, NextResponse } from "next/server";
import { errorResponse, refuse, requireCaller } from "@/server/api";
import { jobView, mayRead } from "@/server/extract";
import { getJob, isExtractJobId } from "@/platform/extract";

// One extraction, polled (12 Nov 2026): what POST /api/extract or
// …/storage/extract answered 202 for.
//
//   GET /api/extract/<id>
//   → { id, status: running | done | failed, result?, error?, wrote?, createdAt, finishedAt }
//
// The account's own jobs only. A member or key held to some workspaces reads
// the jobs of those workspaces, and the account-level jobs it started itself;
// anything else is the same 404 as an id that does not exist. Jobs are kept
// for a day.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    if (!isExtractJobId(id)) return refuse("no such extraction", 404);
    const job = await getJob(tenant, id);
    if (!job || !mayRead(actor, job)) return refuse("no such extraction", 404);
    return NextResponse.json(jobView(job));
  } catch (err) {
    return errorResponse(err);
  }
}
