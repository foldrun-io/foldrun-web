// A pending invite's link, to hand over another way (FOL-464). The link is
// the invite: whoever holds it and the address can join, so it goes only to
// a person (signed in, or their own `foldrun login` key) who could make
// that invite, and every copy is in the audit log. A POST, so nothing
// caches or prefetches it.

import { NextRequest, NextResponse } from "next/server";
import { requirePerson, errorResponse, viaDetail } from "@/server/api";
import { reachableInvite, assertDashboardSession } from "@/server/invite-reach";
import { publicOrigin } from "@/server/auth-flows";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePerson(req, "team:manage", { cliLogin: true });
    await assertDashboardSession(req, actor);
    const { id } = await ctx.params;
    const invite = await reachableInvite(tenant, id, actor);
    await audit("member.invite_link_copied", { actor: actor.name, tenant, subject: invite.email, detail: { inviteId: invite.id, ...viaDetail(actor) } });
    return NextResponse.json({ ok: true, id: invite.id, path: invite.path, url: `${publicOrigin(req)}${invite.path}`, expires: invite.expiresAt }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
