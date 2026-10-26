// The account's compute: the pool its running steps may hold together, the
// most one step may hold, what its running steps hold now, and the steps
// waiting for room. The same figures Settings shows and the room gate
// enforces (platform limits.ts, pod-room.ts). A step past the pool waits —
// with no time limit, in the queue once nothing else of its run is running —
// and starts in turn; a step bigger than the pool or the step maximum fails
// at once.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { accountCompute, computeInUse, roomWaiting } from "@/platform/limits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // The pool is the account's; what is held is summed over the caller's
    // workspaces only, as /api/usage is.
    return NextResponse.json({
      compute: await accountCompute(tenant),
      inUse: computeInUse(tenant, actor.workspaces),
      waiting: roomWaiting(tenant, actor.workspaces),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
