// A run as one tree (FOL-72 step 5): run → step → model call → tool call,
// and the path to the first thing that went wrong — core trace-tree.ts, the
// same tree the run page draws and `foldrun report --tree` prints.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { readRun } from "@/lib/store";
import { buildTraceTree, failurePath } from "@/lib/trace-tree";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; runId: string }> }) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    const run = readRun(tenant, workspace, runId);
    if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const tree = buildTraceTree(run);
    return NextResponse.json({ tree, failure: failurePath(tree) });
  } catch (err) {
    return errorResponse(err);
  }
}
