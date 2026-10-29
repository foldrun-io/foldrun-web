// One teammate: change their role, or remove them. Scoped to the caller's own
// account by the same funnel as everything else — the id alone reaches
// nothing outside it. The rules for who may do what to whom live in
// core/src/permissions.ts, where they are unit-tested.

import { NextRequest, NextResponse } from "next/server";
import { requirePerson, errorResponse, ApiError } from "@/server/api";
import { removeMember, setMemberRole, setMemberScope, listMembers, revokeInvitesBeyond } from "@/server/users";
import { audit } from "@/server/audit";
import { revokeKeysBeyond } from "@/server/auth";
import { isRole } from "@/platform/permissions";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePerson(req, "team:manage");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { role?: unknown; workspaces?: unknown };
    const before = (await listMembers(tenant)).find((m) => m.id === id);
    assertWithinScope(actor.workspaces, before?.workspaces);
    try {
    if (body.role !== undefined) {
      if (!isRole(body.role)) throw new ApiError("expected { role: viewer | editor | admin }", 400);
      // There is exactly one owner and it is transferred, not assigned:
      // POST /api/team/transfer, by the owner. Refused here, before the
      // permission table gets to reason about it.
      if (body.role === "owner") throw new ApiError("owner is not a role you can set — transfer ownership instead (POST /api/team/transfer)", 400);
      await setMemberRole(tenant, id, body.role, actor.id); // throws with a status
      await audit("member.role_changed", { actor: actor.name, tenant, subject: before?.email ?? id, detail: { from: before?.role ?? null, to: body.role } });
    }
    if (body.workspaces !== undefined) {
      const scope = body.workspaces === null ? null : Array.isArray(body.workspaces) ? body.workspaces.filter((w): w is string => typeof w === "string") : undefined;
      if (scope === undefined) throw new ApiError("expected { workspaces: [names] | null }", 400);
      if (actor.workspaces && (scope === null || scope.some((w) => !actor.workspaces!.includes(w)))) throw new ApiError("you can only share workspaces you can open", 403);
      await setMemberScope(tenant, id, scope, actor.id); // throws with a status
      await audit("member.scope_changed", { actor: actor.name, tenant, subject: before?.email ?? id, detail: { from: before?.workspaces ?? null, to: scope } });
    }
    if (body.role === undefined && body.workspaces === undefined) throw new ApiError("nothing to change — send role and/or workspaces", 400);
    } finally {
      // Their keys follow them down (FOL-97): one that reaches more than they
      // now can stops working — also when the role was saved and the
      // workspace change after it was refused.
      const now = (await listMembers(tenant)).find((m) => m.id === id);
      if (now?.email) {
        const revoked = await revokeKeysBeyond(tenant, now.email, { role: now.role, workspaces: now.workspaces ?? null });
        if (revoked.length) await audit("apikey.revoked", { actor: actor.name, tenant, subject: now.email, detail: { keys: revoked, reason: "member's role or workspaces narrowed" } });
        // And the invites they made that they could no longer make.
        const invites = await revokeInvitesBeyond(tenant, { id: now.id, email: now.email }, { role: now.role, workspaces: now.workspaces ?? null }, actor.name);
        if (invites.length) await audit("member.invite_revoked", { actor: actor.name, tenant, subject: now.email, detail: { invites, reason: "its maker's role or workspaces narrowed" } });
      }
    }
    const after = (await listMembers(tenant)).find((m) => m.id === id);
    return NextResponse.json({ ok: true, role: after?.role, workspaces: after?.workspaces ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // A signed-in person with team:manage; the core rule then decides whether
    // THIS person may remove THIS member — an admin may not remove an admin.
    const { tenant, actor } = await requirePerson(req, "team:manage");
    const { id } = await ctx.params;
    const target = (await listMembers(tenant)).find((m) => m.id === id);
    assertWithinScope(actor.workspaces, target?.workspaces);
    // Their pending invites, and any to their address, go in the same
    // transaction (OWASP review, 29 Oct 2026): removal is not undone by a link.
    const removed = await removeMember(tenant, id, actor.id, actor.name);
    if (!removed) return NextResponse.json({ error: "no such member" }, { status: 404 });
    // Every key they minted here stops with them (FOL-97) — a key is not a
    // way to stay on the team.
    const revoked = target?.email ? await revokeKeysBeyond(tenant, target.email, null) : [];
    await audit("member.removed", { actor: actor.name, tenant, subject: target?.email ?? id, detail: { role: target?.role, keysRevoked: revoked, invitesRevoked: removed.invitesRevoked } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A member scoped to some workspaces manages only people who work inside
 *  them — not someone with every workspace, or with one it cannot open. */
function assertWithinScope(mine: string[] | null, theirs: string[] | null | undefined): void {
  if (mine === null || theirs === undefined) return;
  if (theirs === null || theirs.some((w) => !mine.includes(w))) {
    throw new ApiError("that member works in workspaces you were not given — only someone with every workspace can change them", 403);
  }
}
