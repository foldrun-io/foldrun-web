import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { readRun, runOutputPath } from "@/lib/store";
import { byteRange } from "@/server/byte-range";
import { contentDisposition } from "@/server/content-disposition";

// One file a run archived. When a run finishes, whatever its agents left in
// outputs/ is copied under runs/<id>/outputs/<agent>/ so the next run's
// reset does not erase history — and until now nothing could read that copy
// back out. The run page's Out column lists the files and links here —
// at /archive, because a route directory called outputs/ is gitignored.
//
// Read-only, and the bytes are served as what they are, never as a page:
// an agent's HTML opens as text, so a run cannot become a script that runs
// in the dashboard's origin.

const TEXT = new Set([".md", ".txt", ".html", ".htm", ".svg", ".xml", ".yaml", ".yml", ".log", ".js", ".ts", ".py", ".sh"]);
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

/**
 * The bytes from start to end (inclusive), streamed (30 Oct 2026). Both
 * answers used to buffer what they sent — the whole file without a Range,
 * and `bytes=0-` asked for the same — so a few parallel fetches of a
 * multi-GB browser recording held it all on the web pod.
 */
function streamOf(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
}

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
    const file = runOutputPath(tenant, workspace, runId, agent, rel);
    if (!file) return refuse("no such output", 404);
    const ext = path.extname(file).toLowerCase();
    const type = TEXT.has(ext) ? "text/plain; charset=utf-8" : (TYPES[ext] ?? "application/octet-stream");
    const size = fs.statSync(file).size;
    const disposition = contentDisposition("inline", path.basename(file));
    const range = byteRange(req.headers.get("range"), size);
    if (range === "bad") return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (range) {
      return new NextResponse(streamOf(file, range.start, range.end), {
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
    return new NextResponse(size === 0 ? null : streamOf(file, 0, size - 1), {
      headers: {
        "content-type": type,
        "accept-ranges": "bytes",
        "content-length": String(size),
        "content-disposition": contentDisposition("inline", path.basename(file)),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
