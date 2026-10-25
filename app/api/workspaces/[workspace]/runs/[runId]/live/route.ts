import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { readRun } from "@/lib/store";
import { getLiveFrame, liveAgents } from "@/platform/live-view";

// The live view: what a step's browser shows while the step runs. The
// web tool's browse action streams frames through the step's egress lease
// (platform/live-view.ts); this hands the newest one to the run page.
//
//   GET …/live               → { agents: { <agent>: <last frame at> } }
//   GET …/live?agent=<name>  → image/jpeg, or 204 when there is none,
//                              with the page's address and state in headers
//
// A frame is only ever read back for the run it was posted under, which the
// lease pinned, and the run must be this workspace's.

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const agent = req.nextUrl.searchParams.get("agent");
    if (!agent) return NextResponse.json({ agents: await liveAgents(tenant, runId) }, { headers: { "cache-control": "no-store" } });
    const frame = await getLiveFrame(tenant, runId, agent);
    if (!frame) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
    return new NextResponse(new Uint8Array(frame.jpeg), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(frame.jpeg.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-live-url": encodeURIComponent(frame.meta.url),
        "x-live-at": frame.meta.at,
        "x-live-ended": frame.meta.ended ? "1" : "0",
        "x-live-engine": frame.meta.engine,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
