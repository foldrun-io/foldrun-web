// Which files a run archived (5 Nov 2026): the list the run page's Out column
// shows, for a caller that is not the page. When a run finishes, whatever its
// agents left in outputs/ is archived — published to the object store, or
// copied under runs/<id>/outputs/<agent>/ (core run-outputs.ts listRunOutputs
// asks both); each file is fetched through /archive, which this answers
// as `href` — the same link the page draws. At /files, not /outputs: a route
// directory called outputs/ is gitignored (see the archive route).

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readRun } from "@/lib/store";
import { listRunOutputs } from "@/lib/run-outputs";
import { BlobMissing } from "@/lib/publish";
import { BlobTransientError } from "@/lib/blob-store";
import { opsError } from "@/lib/ops-log";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    const run = readRun(tenant, workspace, runId);
    if (!run) return refuse("run not found", 404);
    const base = `/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/archive`;
    let listed: Awaited<ReturnType<typeof listRunOutputs>>;
    try {
      listed = await listRunOutputs(tenant, workspace, runId);
    } catch (err) {
      if (err instanceof BlobMissing || err instanceof BlobTransientError) {
        opsError("run_outputs.list_failed", err, { tenant, workspace, run: runId });
        return refuse("this run's outputs could not be listed from storage", 502);
      }
      throw err;
    }
    const files = listed.map((f) => ({
      agent: f.agent,
      path: f.path,
      bytes: f.bytes,
      href: `${base}?agent=${encodeURIComponent(f.agent)}&path=${encodeURIComponent(f.path)}`,
    }));
    return NextResponse.json({
      runId,
      files,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      // What was not kept (over the install's size limits), on the run record.
      refused: run.outputsRefused ?? [],
      refusedCount: run.outputsRefusedCount ?? run.outputsRefused?.length ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
