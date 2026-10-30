import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { getFile, readFileBytes, requireWorkspace, storedSize } from "@/lib/storage";
import { previewOf } from "@/server/doc-preview";

// A stored file's preview, as data: text, a table, a document's paragraphs,
// a deck's slides, an archive's listing, a page's source, an SVG, or the
// first bytes in hex (server/doc-preview.ts). The storage browser shows
// pictures, video, audio and PDF from the download route directly and asks
// here for everything else — so a format the browser cannot open still
// shows what is in it. JSON, never the file itself: nothing here renders.

export const dynamic = "force-dynamic";

/** Previews read at most this much of a file. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    const rel = req.nextUrl.searchParams.get("path");
    if (!rel) return NextResponse.json({ error: "expected ?path=" }, { status: 400 });
    requireWorkspace(tenant, workspace);
    const record = getFile(tenant, workspace, rel);
    if (!record) return NextResponse.json({ error: `no file ${rel} in ${workspace}` }, { status: 404 });
    // The store's length, not the record's (30 Oct 2026): a record written
    // before registerUpload measured the object holds whatever size the
    // browser claimed, and this read is whole, into memory.
    const size = await storedSize(tenant, workspace, rel);
    if (size === null) return NextResponse.json({ error: "the store has this file listed but could not read its bytes" }, { status: 502 });
    if (Math.max(size, record.size) > MAX_PREVIEW_BYTES) {
      return NextResponse.json({ error: `this file is ${Math.round(Math.max(size, record.size) / 1024 / 1024)} MB — too large to preview; download it` }, { status: 413 });
    }
    const bytes = await readFileBytes(tenant, workspace, rel);
    if (!bytes) return NextResponse.json({ error: "the store has this file listed but could not read its bytes" }, { status: 502 });
    return NextResponse.json(previewOf(record.path, bytes), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
