import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, actorOf, requireAccountWide } from "@/server/api";
import { startingFiles } from "@/server/starters";
import {
  LIBRARY_KINDS,
  listLibrary,
  readLibraryFile,
  writeLibraryFile,
  libraryFileExists,
  deleteLibraryPath,
  type LibraryKind,
} from "@/lib/library";
import { idempotent } from "@/server/idempotency";

function kindOf(raw: string): LibraryKind {
  if (!LIBRARY_KINDS.includes(raw as LibraryKind)) {
    throw new Error(`unknown library kind "${raw}" — expected ${LIBRARY_KINDS.join(" | ")}`);
  }
  return raw as LibraryKind;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const tenant = await requireTenant(req);
    const kind = kindOf((await ctx.params).kind);
    const rel = req.nextUrl.searchParams.get("path");
    if (rel) return NextResponse.json({ path: rel, content: readLibraryFile(tenant, kind, rel) });
    return NextResponse.json({ kind, entries: listLibrary(tenant, kind) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST creates from a template (dashboard "New"); PUT writes exact content.
async function postOnce(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const tenant = (await requireAccountWide(req, "workspace:write")).tenant;
    const kind = kindOf((await ctx.params).kind);
    const body = (await req.json()) as { name?: string; template?: string; language?: string };
    if (!body.name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.name)) {
      return NextResponse.json({ error: "expected { name } in kebab-case" }, { status: 400 });
    }
    // "Start from" — a gallery entry as the starting content, renamed to what
    // the author called it. An unknown template falls back to the blank one
    // rather than failing: the name is the thing they asked for.
    // One "start from" axis carries both cases: a blank tool of a given
    // transport, or a gallery entry adapted under the author's name.
    // startingFiles answers in paths relative to a WORKSPACE root, so a tool
    // comes back as `tools/x/tool.md`. writeLibraryFile is already inside the
    // kind's directory, so passing that through wrote
    // `library/tools/tools/x/tool.md` — a real tool at a path the loader
    // cannot see, which is how "New tool" at account scope silently produced
    // nothing. Strip the kind the caller already knows.
    const files = startingFiles(kind, body.name, body.template, body.language).map((f) => ({
      ...f,
      file: f.file.startsWith(`${kind}/`) ? f.file.slice(kind.length + 1) : f.file,
    }));
    // Creating over something that exists is not creating. The old behaviour
    // overwrote the definition and left the previous program beside it —
    // making a tool again in a different language left an orphaned run.mjs
    // that nothing referenced and nothing cleaned up.
    const clash = files.find((f) => libraryFileExists(tenant, kind, f.file));
    if (clash) {
      return NextResponse.json(
        { error: `${clash.file} already exists — pick another name` },
        { status: 409 },
      );
    }
    for (const f of files) writeLibraryFile(tenant, kind, f.file, f.content);
    return NextResponse.json({ ok: true, path: files[0].file });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const tenant = (await requireAccountWide(req, "workspace:write")).tenant;
    const kind = kindOf((await ctx.params).kind);
    const body = (await req.json()) as { path?: string; content?: string };
    if (!body.path || typeof body.content !== "string") {
      return NextResponse.json({ error: "expected { path, content }" }, { status: 400 });
    }
    writeLibraryFile(tenant, kind, body.path, body.content, { by: await actorOf(req) });
    return NextResponse.json({ ok: true, path: body.path });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const tenant = (await requireAccountWide(req, "workspace:write")).tenant;
    const kind = kindOf((await ctx.params).kind);
    const body = (await req.json()) as { path?: string };
    if (!body.path || typeof body.path !== "string") return NextResponse.json({ error: "expected { path }" }, { status: 400 });
    // Attributed like a write: a deletion is a revision too.
    deleteLibraryPath(tenant, kind, body.path, { by: await actorOf(req) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
