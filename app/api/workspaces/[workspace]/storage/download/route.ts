import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import path from "node:path";
import { getFile, downloadUrl, readFileBytes, previewType } from "@/lib/storage";
import { byteRange } from "@/server/byte-range";
import { contentDisposition } from "@/server/content-disposition";

// Downloads. On an object store this redirects to a short-lived signed URL so
// the bytes never touch this process; on the fs driver it streams them.
//
// Both paths send `Content-Disposition: attachment`, and the signed URL is
// signed *with* that header override so it cannot be stripped by editing the
// link. This is not politeness about save dialogs — an agent that writes
// report.html is otherwise publishing a page on the dashboard's own origin,
// with the session cookie attached. A file store hands out files; it never
// renders one.

// What the gate may render inline: pictures as pictures, text as plain text
// (never text/html — a stored page must not become a page from here).
const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".md": "text/plain; charset=utf-8", ".mdx": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    const rel = req.nextUrl.searchParams.get("path");
    if (!rel) return NextResponse.json({ error: "expected ?path=" }, { status: 400 });

    const record = getFile(tenant, workspace, rel);
    if (!record) return NextResponse.json({ error: "no such file" }, { status: 404 });

    // ?inline=1: the gate shows the thumbnail or the spec a step is about to
    // publish. Only the types above, only by extension, still sandboxed — a
    // stored HTML file is never rendered as a page from here.
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const imageType = IMAGE_TYPES[path.extname(record.path).toLowerCase()];

    // Video, audio and PDF preview as themselves in the storage browser —
    // types that run no script, with the type forced by extension. On an
    // object store the browser is sent to a signed link that says inline
    // (the bytes never pass through here); on this server they are served
    // with byte ranges, which is how a video element seeks.
    const media = inline && !imageType ? previewType(record.path) : null;
    if (media) {
      const signed = await downloadUrl(tenant, workspace, record, { inline: true });
      if (signed) return NextResponse.redirect(signed, 302);
      const bytes = await readFileBytes(tenant, workspace, rel);
      if (!bytes) return NextResponse.json({ error: "no such file" }, { status: 404 });
      const headers: Record<string, string> = {
        "content-type": media,
        "accept-ranges": "bytes",
        "content-disposition": contentDisposition("inline", path.basename(record.path)),
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=60",
      };
      const range = byteRange(req.headers.get("range"), bytes.length);
      if (range === "bad") return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${bytes.length}` } });
      if (range) {
        const part = bytes.subarray(range.start, range.end + 1);
        return new NextResponse(new Uint8Array(part), { status: 206, headers: { ...headers, "content-length": String(part.length), "content-range": `bytes ${range.start}-${range.end}/${bytes.length}` } });
      }
      return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
    }

    // An inline preview is served from here even on an object store. The
    // gate reads it with fetch() and a tenant header, and a redirect to the
    // store's origin turns that into a cross-origin request the store
    // refuses — the picture beside it loaded because <img> follows redirects
    // without asking. A preview is small by construction (the gate names a
    // cover and a spec); the download proper still redirects so big files
    // never pass through this process.
    if (!(inline && imageType)) {
      const signed = await downloadUrl(tenant, workspace, record);
      if (signed) return NextResponse.redirect(signed, 302);
    }

    const bytes = await readFileBytes(tenant, workspace, rel);
    if (!bytes) return NextResponse.json({ error: "no such file" }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": inline && imageType ? imageType : "application/octet-stream",
        "content-length": String(bytes.length),
        "content-disposition": contentDisposition(inline && imageType ? "inline" : "attachment", path.basename(record.path)),
        // Belt and braces: no sniffing back to text/html on an old browser.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
