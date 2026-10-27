// The account's compute at every level: the pool its running steps may hold
// together and the most one step may hold (cores, GiB and disk), each
// workspace's and live run's own pool and what it holds, and the steps
// waiting for room. The same figures Settings shows and the room gate
// enforces (platform limits.ts, pod-room.ts). A step past the pool waits —
// with no time limit, in the queue once nothing else of its run is running —
// and starts in turn; a step bigger than the pool or the step maximum fails
// at once.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { accountCompute, computeHeld, roomWaiting, workspaceCompute } from "@/platform/limits";
import { listWorkspaces } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // The pool is the account's; what is held is summed over the caller's
    // workspaces only, as /api/usage is.
    // Every level (27 Oct 2026): the account's pool, each workspace's own
    // pool and what its steps hold, and each live run with a pool of its
    // own or anything held.
    const held = computeHeld(tenant, actor.workspaces);
    const names = listWorkspaces(tenant).map((w) => w.name).filter((n) => !actor.workspaces || actor.workspaces.includes(n));
    return NextResponse.json({
      compute: await accountCompute(tenant),
      inUse: held.total,
      workspaces: names.map((workspace) => ({ workspace, pool: workspaceCompute(tenant, workspace), inUse: held.workspaces[workspace] ?? { vcpu: 0, memGiB: 0, diskGiB: 0, steps: 0 } })),
      runs: held.runs,
      waiting: roomWaiting(tenant, actor.workspaces),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
