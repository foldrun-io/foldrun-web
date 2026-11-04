// Which files a run archived (5 Nov 2026): the list the run page's Out column
// shows, for a caller that is not the page. When a run finishes, whatever its
// agents left in outputs/ is copied under runs/<id>/outputs/<agent>/ (core
// listRunOutputs); each file is fetched through /archive, which this answers
// as `href` — the same link the page draws. At /files, not /outputs: a route
// directory called outputs/ is gitignored (see the archive route).

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readRun, listRunOutputs } from "@/lib/store";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return refuse("run not found", 404);
    const base = `/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/archive`;
    const files = listRunOutputs(tenant, workspace, runId).map((f) => ({
      agent: f.agent,
      path: f.path,
      bytes: f.bytes,
      href: `${base}?agent=${encodeURIComponent(f.agent)}&path=${encodeURIComponent(f.path)}`,
    }));
    return NextResponse.json({
      runId,
      files,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
