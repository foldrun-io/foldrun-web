import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireCaller, requirePermission, errorResponse, ApiError } from "@/server/api";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { workspaceDir } from "@/lib/store";
import { AVATAR_KINDS, AVATAR_MAX_BYTES, readAvatar, setAvatar, deleteAvatar, avatarUrl, type AvatarKind } from "@/platform/avatars";
import fs from "node:fs";
import { scopeAllows } from "@/platform/scope";

// A picture for a person, a workspace or the account.
//
//   GET     the bytes, cached for a year — the URL carries the file's mtime,
//           so a new picture is a new URL
//   PUT     the bytes of a PNG, JPEG or WebP, at most a megabyte; a person
//           may set their own, an admin a workspace's or the account's
//   DELETE  back to the initial

function kindOf(raw: string): AvatarKind | null {
  return (AVATAR_KINDS as string[]).includes(raw) ? (raw as AvatarKind) : null;
}

async function mayWrite(req: NextRequest, kind: AvatarKind, id: string): Promise<string> {
  if (kind === "user") {
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    const tenant = await requireTenant(req);
    // Your own face only; an admin who wants to change someone else's asks them.
    if (!session || session.id !== id) {
      if (process.env.FOLDRUN_DEV_NO_AUTH === "1") return tenant;
      throw new ApiError("only that person can change their picture", 403);
    }
    return tenant;
  }
  const { tenant, actor } = await requirePermission(req, "workspace:manage");
  if (kind === "workspace" && actor.workspaces !== null && !scopeAllows(actor.workspaces, id)) throw new ApiError("this workspace is not one you were given access to", 403);
  if (kind === "account" && actor.workspaces !== null) throw new ApiError("the account's picture is shared by every workspace — a scoped member cannot change it", 403);
  if (kind === "workspace" && !fs.existsSync(workspaceDir(tenant, id))) throw new ApiError("workspace not found", 404);
  if (kind === "account" && id !== tenant) throw new ApiError("that is not this account", 403);
  return tenant;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind: rawKind, id } = await ctx.params;
    const kind = kindOf(rawKind);
    if (!kind) return NextResponse.json({ error: "no such kind" }, { status: 404 });
    const { tenant, actor } = await requireCaller(req);
    // A workspace's picture is read by callers who may open that workspace,
    // as its write is (30 Oct 2026): assertScope guards /api/workspaces/…
    // paths only, and this one names the workspace in its own.
    if (kind === "workspace" && actor.workspaces !== null && !scopeAllows(actor.workspaces, id)) throw new ApiError("this workspace is not one you were given access to", 403);
    const hit = readAvatar(tenant, kind, id);
    if (!hit) return NextResponse.json({ error: "no picture" }, { status: 404 });
    return new NextResponse(new Uint8Array(hit.bytes), {
      headers: { "content-type": hit.mime, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind: rawKind, id } = await ctx.params;
    const kind = kindOf(rawKind);
    if (!kind) return NextResponse.json({ error: "no such kind" }, { status: 404 });
    const tenant = await mayWrite(req, kind, id);
    if (Number(req.headers.get("content-length") ?? 0) > AVATAR_MAX_BYTES) return NextResponse.json({ error: "image too large — the limit is 1 MB" }, { status: 413 });
    const bytes = Buffer.from(await req.arrayBuffer());
    setAvatar(tenant, kind, id, bytes);
    return NextResponse.json({ ok: true, url: avatarUrl(tenant, kind, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind: rawKind, id } = await ctx.params;
    const kind = kindOf(rawKind);
    if (!kind) return NextResponse.json({ error: "no such kind" }, { status: 404 });
    const tenant = await mayWrite(req, kind, id);
    return NextResponse.json({ ok: true, removed: deleteAvatar(tenant, kind, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
