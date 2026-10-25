// Mint, list and revoke public links to a workspace's files.
//
// `workspace:write` (editor) gates this, the same level that can already push
// to a repository and trigger a deploy — publishing bytes is in that family,
// not below it.

import { NextRequest, NextResponse } from "next/server";
import { actorOf, errorResponse, requirePermission } from "@/server/api";
import { createShare, listShares, revokeShare, shareUrl } from "@/platform/shares.ts";
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
      return NextResponse.json({ error: "expected { path } — the file to share" }, { status: 400 });
    }

    // Refuse before creating anything if this install cannot say where it is
    // reachable. A share nobody outside can fetch is not a share, and handing
    // back a token with no URL just moves the failure somewhere less obvious.
    try {
      shareUrl("probe");
    } catch {
      return NextResponse.json(
        {
          error:
            "this install has no public origin — set FOLDRUN_PUBLIC_URL to the URL the outside world reaches it on, then share again",
        },
        { status: 409 },
      );
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
    const tenant = (await requirePermission(req, "workspace:read")).tenant;
    const shares = (await listShares(tenant, workspace)).map((s) => ({
      token: s.token,
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
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!token) return NextResponse.json({ error: "expected ?token=" }, { status: 400 });
    return NextResponse.json({ ok: true, revoked: await revokeShare(tenant, token, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
