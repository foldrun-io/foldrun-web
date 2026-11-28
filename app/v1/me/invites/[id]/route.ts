// Answer one invite that waits on you (FOL-464):
//
//   POST { action: "join" }     you become a member of its account, with the
//                               role and projects the invite holds. Your
//                               session stays where it is: move with the
//                               account menu, or POST /v1/auth/session.
//   POST { action: "decline" }  the invite is over, for both of its links;
//                               the one who made it is told.
//
// Only the person it is addressed to, with that address confirmed. Anything
// else — another person's invite, a used or revoked one, an id that never
// existed — gets the one sentence a dead link gets.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ApiError, viaDetail } from "@/server/api";
import { requireSelf } from "@/server/invite-reach";
import { declineInvite, joinById } from "@/server/users";
import { tellInviter } from "@/server/invite-notices";
import { audit } from "@/server/audit";
import { jsonObject } from "@/server/body";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // `from` is checked again under the people lock (users.ts assertStillThem).
    const { actor, from } = await requireSelf(req);
    const { id } = await ctx.params;
    const body = (await jsonObject(req)) as { action?: unknown };
    if (body.action !== "join" && body.action !== "decline") throw new ApiError('action is "join" or "decline"', 400);
    if (body.action === "decline") {
      const row = await declineInvite(id, actor.id, from);
      await audit("member.invite_declined", { actor: actor.name, tenant: row.tenant, subject: row.email, detail: { inviteId: row.id, role: row.role, invitedBy: row.createdByEmail, ...viaDetail(actor) } });
      await tellInviter(row, "declined");
      return NextResponse.json({ ok: true, declined: true, account: row.tenant });
    }
    const { user, invite } = await joinById(id, actor.id, from);
    await audit("member.joined", {
      actor: user.email,
      tenant: invite.tenant,
      subject: user.email,
      detail: { role: invite.role, workspaces: invite.workspaces, inviteId: invite.id, invitedBy: invite.createdByEmail, existingLogin: true, ...viaDetail(actor) },
    });
    await tellInviter(invite, "accepted");
    return NextResponse.json({ ok: true, joined: true, account: invite.tenant, role: invite.role, workspaces: invite.workspaces });
  } catch (err) {
    return errorResponse(err);
  }
}
