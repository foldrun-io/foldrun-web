import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireTenant, errorResponse } from "@/server/api";
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  try {
    const { workspace, runId } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!readRun(tenant, workspace, runId)) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const agent = req.nextUrl.searchParams.get("agent") ?? "";
    const rel = req.nextUrl.searchParams.get("path") ?? "";
    const file = runOutputPath(tenant, workspace, runId, agent, rel);
    if (!file) return NextResponse.json({ error: "no such output" }, { status: 404 });
    const ext = path.extname(file).toLowerCase();
    const type = TEXT.has(ext) ? "text/plain; charset=utf-8" : (TYPES[ext] ?? "application/octet-stream");
    const size = fs.statSync(file).size;
    const disposition = contentDisposition("inline", path.basename(file));
    const range = byteRange(req.headers.get("range"), size);
    if (range === "bad") return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (range) {
      const fd = fs.openSync(file, "r");
      const part = Buffer.alloc(range.end - range.start + 1);
      try { fs.readSync(fd, part, 0, part.length, range.start); } finally { fs.closeSync(fd); }
      return new NextResponse(new Uint8Array(part), {
        status: 206,
        headers: {
          "content-type": type,
          "content-length": String(part.length),
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
          "accept-ranges": "bytes",
          "content-disposition": disposition,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    }
    const bytes = fs.readFileSync(file);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": type,
        "accept-ranges": "bytes",
        "content-length": String(bytes.length),
        "content-disposition": contentDisposition("inline", path.basename(file)),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
