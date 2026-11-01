// DELETE /api/mcp/connections/<id> — end an AI app's connection: the grant is
// marked revoked and every token it issued stops at once (server/mcp-oauth.ts).
// Your own, or any with keys:manage. Revoking one already revoked is a 404.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, refuse, requireCaller } from "@/server/api";
import { getGrant, revokeGrant } from "@/server/mcp-oauth";
import { can } from "@/platform/permissions";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    const grant = await getGrant(tenant, id);
    if (!grant || grant.revokedAt) return refuse("no such connection", 404);
    const mine = grant.email.toLowerCase() === actor.name.toLowerCase();
    if (!mine && !can(actor.role, "keys:manage")) return refuse(`this is ${grant.email}'s connection — revoking another person's needs admin`, 403);
    await revokeGrant(tenant, id, actor.name);
    return NextResponse.json({ ok: true, id, revoked: true });
  } catch (err) {
    return errorResponse(err);
  }
}
