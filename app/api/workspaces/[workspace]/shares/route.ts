// Mint, list and revoke public links to a workspace's files.
//
// `workspace:write` (editor) gates this, the same level that can already push
// to a repository and trigger a deploy — publishing bytes is in that family,
// not below it.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, errorResponse, requirePermission, refuse } from "@/server/api";
import { createShare, listShares, maskToken, readerSeesToken, revokeShare, shareId, shareUrl, tokenForShareId } from "@/platform/shares.ts";
import { can } from "@/platform/permissions";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as {
      path?: string;
      ttlDays?: number | null;
    };
    if (!body.path) {
      return refuse("expected { path } — the file to share", 400);
    }

    // Refuse before creating anything if this install cannot say where it is
    // reachable. A share nobody outside can fetch is not a share, and handing
    // back a token with no URL just moves the failure somewhere less obvious.
    try {
      shareUrl("probe");
    } catch {
      return refuse("this install has no public origin — set FOLDRUN_PUBLIC_URL to the URL the outside world reaches it on, then share again", 409);
    }

    const share = await createShare(tenant, workspace, body.path, {
      ttlDays: body.ttlDays,
      // Who made it is the caller, as the storage routes record it — not a
      // name the request body chose (every CLI share read "api-key", and any
      // caller could write anyone's name).
      createdBy: await actorOf(req),
    });
    const url = shareUrl(share.token);
    return NextResponse.json({
      ok: true,
      url,
      token: share.token,
      id: shareId(share.token),
      path: share.path,
      contentType: share.contentType,
      expiresAt: share.expiresAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:read");
    // A token is the link itself, and a link outlives the access of whoever
    // copies it (30 Oct 2026): a viewer who listed every token kept working
    // public links after their key was revoked. Admins and a link's own maker
    // see its token and URL; everyone else sees that it exists — path, dates,
    // maker — with the token masked and `id` to revoke it by.
    const reader = { admin: can(actor.role, "workspace:manage"), name: actor.name };
    const shares = (await listShares(tenant, workspace)).map((s) => ({
      ...(readerSeesToken(s, reader)
        ? { token: s.token, masked: false, url: urlOf(s.token) }
        : { token: maskToken(s.token), masked: true, url: null }),
      id: shareId(s.token),
      path: s.path,
      contentType: s.contentType,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
    }));
    return NextResponse.json({ ok: true, shares });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const q = new URL(req.url).searchParams;
    // By token, or by id — the handle a list gives a reader whose tokens are
    // masked, so an editor can still take down a colleague's link.
    const id = q.get("id") ?? "";
    const token = id ? await tokenForShareId(tenant, workspace, id) : q.get("token") ?? "";
    if (!id && !token) return refuse("expected ?token= or ?id=", 400);
    if (!token) return NextResponse.json({ ok: true, revoked: false });
    return NextResponse.json({ ok: true, revoked: await revokeShare(tenant, token, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The public URL, or null when this install has none (shareUrl throws). */
function urlOf(token: string): string | null {
  try {
    return shareUrl(token);
  } catch {
    return null;
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
