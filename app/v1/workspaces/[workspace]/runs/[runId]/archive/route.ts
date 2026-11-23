import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readRun } from "@/lib/store";
import { openRunOutput } from "@/lib/run-outputs";
import { BlobMissing } from "@/lib/publish";
import { BlobTransientError } from "@/lib/blob-store";
import { opsError } from "@/lib/ops-log";
import { byteRange } from "@/server/byte-range";
import { contentDisposition } from "@/server/content-disposition";

// One file a run archived. When a run finishes, whatever its agents left in
// outputs/ is archived — published to the object store, or copied under
// runs/<id>/outputs/<agent>/ — so the next run's reset does not erase
// history, and this reads it back out (core run-outputs.ts asks both). The run page's Out column lists the files and links here —
// at /archive, because a route directory called outputs/ is gitignored.
//
// Read-only, and the bytes are served as what they are, never as a page:
// an agent's HTML opens as text, so a run cannot become a script that runs
// in the dashboard's origin.

const TEXT = new Set([".md", ".txt", ".html", ".htm", ".svg", ".xml", ".yaml", ".yml", ".log", ".js", ".ts", ".py", ".sh", ".patch", ".diff"]);
const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  // A browser's recording (web action=browse video=) plays in the run page.
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".har": "application/json; charset=utf-8",
  ".cpuprofile": "application/json; charset=utf-8",
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return refuse("run not found", 404);
    const agent = req.nextUrl.searchParams.get("agent") ?? "";
    const rel = req.nextUrl.searchParams.get("path") ?? "";
    // From the object store, or (a run archived before outputs moved there, or
    // on an install without one) from the volume: core run-outputs.ts asks both.
    let out: Awaited<ReturnType<typeof openRunOutput>>;
    try {
      out = await openRunOutput(tenant, workspace, runId, agent, rel);
    } catch (err) {
      // The store lost the bytes or cannot be reached: a fault on our side, said as one (never an empty file).
      if (err instanceof BlobMissing || err instanceof BlobTransientError) {
        opsError("run_outputs.read_failed", err, { tenant, workspace, run: runId });
        return refuse("this output could not be read from storage", 502);
      }
      throw err;
    }
    if (!out) return refuse("no such output", 404);
    const ext = path.extname(rel).toLowerCase();
    const type = TEXT.has(ext) ? "text/plain; charset=utf-8" : (TYPES[ext] ?? "application/octet-stream");
    const size = out.size;
    const disposition = contentDisposition("inline", path.basename(rel));
    const range = byteRange(req.headers.get("range"), size);
    if (range === "bad") return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (range) {
      return new NextResponse(out.read({ start: range.start, end: range.end }), {
        status: 206,
        headers: {
          "content-type": type,
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
          "accept-ranges": "bytes",
          "content-disposition": disposition,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    }
    return new NextResponse(size === 0 ? null : out.read(), {
      headers: {
        "content-type": type,
        "accept-ranges": "bytes",
        "content-length": String(size),
        "content-disposition": disposition,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
