// The environments a workspace's agents need, and whether each is built.
//
// Every distinct runtime the workspace's agents declare (their own
// `runtime:` merged with their tools'), with the outcome of the last build
// the worker ran for it at deploy (foldrun-platform runtime-warm.ts):
// "ready", "failed" with the installer's error, "building", or "pending"
// before the worker has picked the change up. `foldrun deploy` polls this
// to say, at deploy time, whether a package will not install.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/server/api";
import { workspaceRuntimeReport } from "@/platform/runtime-warm.ts";
import { requireWorkspace } from "@/lib/storage";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:read")).tenant;
    // A name with no workspace is a 404 as on its siblings (30 Oct 2026),
    // not an empty answer that reads as "nothing here".
    requireWorkspace(tenant, workspace);
    return NextResponse.json({ workspace, runtimes: workspaceRuntimeReport(tenant, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}
