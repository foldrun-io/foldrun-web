// Send a pending invite's mail again (FOL-464): the same link, to the
// address it was made for. At most once in ten minutes, and within the
// day's limit for that address.
//
// A person (signed in, or their own `foldrun login` key) who could make
// that invite: it mails someone in their name.

import { NextRequest, NextResponse } from "next/server";
import { requirePerson, errorResponse, ApiError, viaDetail } from "@/server/api";
import { reachableInvite, assertDashboardSession } from "@/server/invite-reach";
import { countResend, ONE_MAILBOX } from "@/server/invite-limits";
import { sendInviteEmail } from "@/server/email";
import { publicOrigin } from "@/server/auth-flows";
import { describeScope } from "@/platform/scope";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePerson(req, "team:manage", { cliLogin: true });
    await assertDashboardSession(req, actor);
    const { id } = await ctx.params;
    const invite = await reachableInvite(tenant, id, actor);
    if (!invite.email) throw new ApiError("that invite names no address to mail — copy its link instead", 400);
    // An invite from before 28 Nov 2026 may hold more than one mailbox in its address.
    if (!ONE_MAILBOX.test(invite.email)) throw new ApiError("that invite's address is not one mailbox — revoke it and make a new one", 400);
    await countResend(tenant, actor.id, invite.id, invite.email);
    const sent = await sendInviteEmail(tenant, invite.email, `${publicOrigin(req)}${invite.mailPath}`, { from: invite.invitedBy, role: invite.role, scope: describeScope(invite.workspaces), expires: new Date(invite.expiresAt) });
    await audit("member.invite_resent", { actor: actor.name, tenant, subject: invite.email, detail: { inviteId: invite.id, sent: sent.ok, ...viaDetail(actor) } });
    return NextResponse.json({ ok: true, id: invite.id, sent: sent.ok, sendError: sent.ok ? null : sent.error });
  } catch (err) {
    return errorResponse(err);
  }
}
