import { NextRequest, NextResponse } from "next/server";
import { errorResponse, actorOf, requirePermission, requireTenant, requireAccountWide } from "@/server/api";
import { GALLERY, galleryDrift, galleryFiles, galleryTool, writeGalleryCopy } from "@/platform/gallery";
import { libraryFileExists, readLibraryFile } from "@/lib/library";
import { idempotent } from "@/server/idempotency";

/**
 * The gallery itself: every tool the platform ships to every account, whole
 * — definition and program — and whether this account keeps its own copy.
 * The CLI lays it down on a laptop so `foldrun run` finds `web` and
 * the rest the way a run on the platform does, without installing anything.
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant(req);
    const read = (rel: string) => (libraryFileExists(tenant, "tools", rel) ? readLibraryFile(tenant, "tools", rel) : null);
    const tools = GALLERY.map((t) => ({
      name: t.name,
      kind: t.kind,
      title: t.title,
      description: t.description,
      files: galleryFiles(t),
      installed: t.kind === "tools" ? (galleryDrift(t.file, read)?.status ?? null) : null,
    }));
    return NextResponse.json({ tools });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Bring an installed gallery tool up to the version the platform ships.
 * An install is a copy, so an upgrade is a second copy, written through
 * writeLibraryFile so the revision log records who and when — and the
 * previous content is one revision back if it was a customisation after
 * all. Only the account library: a workspace's own copy is the workspace's
 * to change through its repo.
 */
async function postOnce(req: NextRequest) {
  try {
    const tenant = (await requireAccountWide(req, "workspace:write")).tenant;
    const body = (await req.json()) as { tool?: string };
    const tool = body.tool ? galleryTool(body.tool) : undefined;
    if (!tool) return NextResponse.json({ error: `no gallery tool named "${body.tool ?? ""}"` }, { status: 404 });
    const by = await actorOf(req);
    const message = `upgraded ${tool.name} to the gallery's current version`;
    // Stamped, so the automatic sync after a deploy knows this copy is the
    // gallery's and keeps it current from now on.
    writeGalleryCopy(tenant, tool, { by, message });
    return NextResponse.json({ ok: true, path: tool.file });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
