// Take back one invite before it is used. The link stops working at once.
// 404 for an id that is not this account's; 409 for one already accepted
// (remove the member instead); one already revoked or expired answers 200,
// `revoked: false`, so a retry is harmless.
//
// team:manage, a key included — revoking only narrows access. The same
// fences as a member: a caller scoped to some workspaces revokes only
// invites inside its scope, and an admin invite is the owner's to take
// back, as it is the owner's to make.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, ApiError } from "@/server/api";
import { findInvite, revokeInvite } from "@/server/users";
import { audit } from "@/server/audit";
import { can } from "@/platform/permissions";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePermission(req, "team:manage");
    const { id } = await ctx.params;
    const invite = await findInvite(tenant, id);
    if (!invite) throw new ApiError("no such invite", 404);
    const mine = actor.workspaces;
    if (mine !== null && (invite.workspaces === null || invite.workspaces.some((w) => !mine.includes(w)))) {
      throw new ApiError("that invite opens workspaces you were not given — only someone with every workspace can revoke it", 403);
    }
    if (invite.role === "admin" && !can(actor.role, "admins:manage")) {
      throw new ApiError("only the owner can revoke an admin invite", 403);
    }
    const { invite: after, changed } = await revokeInvite(tenant, id, actor.name); // 404 / 409 with a status
    if (changed) {
      await audit("member.invite_revoked", { actor: actor.name, tenant, subject: after.email, detail: { invites: [after.id], role: after.role, workspaces: after.workspaces, reason: "revoked" } });
    }
    return NextResponse.json({ ok: true, revoked: changed, invite: after });
  } catch (err) {
    return errorResponse(err);
  }
}
