import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission, actorOf } from "@/server/api";
import {
  listStorage,
  putFile,
  registerUpload,
  deleteFile,
  usedBytes,
  driverFor,
  requireWorkspace,
} from "@/lib/storage";
import { bodyCut } from "@/server/body-limit";
import { idempotent } from "@/server/idempotency";

// The file store's HTTP surface. Three verbs, one noun:
//
//   GET     what this workspace holds, plus the quota line the UI draws
//   POST    register bytes the browser already PUT straight to the bucket
//   PUT     take the bytes here instead — the fs driver, and the fallback
//           for anyone without a presigned upload
//   DELETE  drop a file
//
// Uploads prefer the direct path (see files/upload-url) because proxying a
// 400MB PDF through the dashboard process costs its memory, its request
// timeout and, on the hosted platform, the same bytes twice on the wire.

/** Who did this, for the record's `by`. Runs stamp themselves `run:<id>`.
 *  An API key has a tenant but no person behind it, so it says so rather
 *  than borrowing someone's name. */
/** Who wrote a file, as the storage listing shows it: `user:<email>` for a
 *  person and for a key minted by one (actorOf resolves the key's minter),
 *  else `key:<label>`. It used to say "api-key" for every CLI upload. */
async function actor(req: NextRequest): Promise<string> {
  const who = await actorOf(req);
  return who.includes("@") ? `user:${who}` : who;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    // A name with no workspace is a 404, here and on every write (core
    // storage.ts requireWorkspace, 30 Oct 2026) — not an empty store.
    requireWorkspace(tenant, workspace);
    return NextResponse.json({
      files: listStorage(tenant, workspace),
      driver: driverFor(tenant, workspace).kind,
      used: usedBytes(tenant, workspace),
      quotaMb: Number(process.env.FOLDRUN_STORAGE_QUOTA_MB ?? 5120),
      maxMb: Number(process.env.FOLDRUN_STORAGE_MAX_MB ?? 512),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json()) as { path?: string; sha?: string; size?: number };
    if (!body.path || !body.sha || typeof body.size !== "number") {
      return NextResponse.json({ error: "expected { path, sha, size }" }, { status: 400 });
    }
    // registerUpload HEADs the object before it believes any of this — the
    // browser saying an upload finished is not evidence that it did, and
    // `size` is not the size: the record, the per-file limit and the quota
    // use the length the store reports (30 Oct 2026).
    const file = await registerUpload(tenant, workspace, body.path, body.sha, body.size, await actor(req));
    return NextResponse.json({ file });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const rel = req.nextUrl.searchParams.get("path");
    if (!rel) return NextResponse.json({ error: "expected ?path=" }, { status: 400 });
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
    // The proxy refused a declared length over the limit; a chunked body
    // reaches here cut short and looking whole (server/body-limit.ts).
    const cut = bodyCut(req.headers.get("content-length"), bytes.length);
    if (cut) return NextResponse.json({ error: cut.error }, { status: cut.status });
    const file = await putFile(tenant, workspace, rel, bytes, await actor(req));
    return NextResponse.json({ file });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const rel = req.nextUrl.searchParams.get("path");
    if (!rel) return NextResponse.json({ error: "expected ?path=" }, { status: 400 });
    requireWorkspace(tenant, workspace);
    const gone = await deleteFile(tenant, workspace, rel);
    if (!gone) return NextResponse.json({ error: "no such file" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
