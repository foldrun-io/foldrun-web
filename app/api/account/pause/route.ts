// The account's kill switch: every workspace at once.
//
//   GET                              { paused, account, workspaces } — the account's pause, and each paused workspace
//   POST { reason?, stop?: true }    pause the account; stop also stops every live run
//   DELETE                           resume the account (a workspace paused on its own stays paused)
//
// A caller scoped to some workspaces cannot pause the whole account: that
// would stop desks it was never given.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requirePermission, errorResponse, ApiError } from "@/server/api";
import { pauseView, pause, resume } from "@/server/pause";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    return NextResponse.json(await pauseView(tenant, null, actor.workspaces));
  } catch (err) {
    return errorResponse(err);
  }
}

async function wholeAccount(req: NextRequest) {
  const { tenant, actor } = await requirePermission(req, "workspace:manage");
  if (actor.workspaces !== null) throw new ApiError("pausing the account needs access to every workspace — pause the ones you were given instead", 403);
  return { tenant, actor };
}

export async function POST(req: NextRequest) {
  try {
    const { tenant, actor } = await wholeAccount(req);
    return await pause(tenant, actor, null, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenant, actor } = await wholeAccount(req);
    return await resume(tenant, actor, null);
  } catch (err) {
    return errorResponse(err);
  }
}
