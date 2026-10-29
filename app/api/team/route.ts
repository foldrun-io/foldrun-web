// The team behind an account. GET lists members with their roles; POST mints
// an invite link that grants one. An invite is a row (since 29 Oct 2026):
// the link names it, it works once, for seven days, and it can be revoked —
// GET/DELETE /api/team/invites. A newer invite to the same address revokes
// the older ones still pending.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requirePerson, errorResponse, ApiError } from "@/server/api";
import { listMembers, mintInvite } from "@/server/users";
import { listWorkspaces } from "@/lib/store";
import { describeScope, scopeAllows } from "@/platform/scope";
import { sendInviteEmail } from "@/server/email";
import { publicOrigin } from "@/server/auth-flows";
import { audit } from "@/server/audit";
import { isRole, can } from "@/platform/permissions";
import { idempotent } from "@/server/idempotency";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const members = await listMembers(tenant);
    // A caller scoped to some workspaces sees each teammate's scope only
    // where it overlaps their own — the names of the workspaces they were
    // not given are not learned from the team page. "All workspaces"
    // stays as it is: it names nothing.
    const visible = actor.workspaces === null
      ? members
      : members.map((m) => ({ ...m, workspaces: m.workspaces === null ? null : m.workspaces.filter((w) => scopeAllows(actor.workspaces, w)) }));
    return NextResponse.json({ members: visible });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePerson(req, "team:manage");
    const body = (await req.json().catch(() => ({}))) as { role?: unknown; workspaces?: unknown; email?: unknown; send?: unknown };
    const role = body.role ?? "editor";
    if (!isRole(role) || role === "owner") throw new ApiError("role must be viewer, editor or admin", 400);
    if (role === "admin" && !can(actor.role, "admins:manage")) {
      throw new ApiError("only the owner can invite an admin", 403);
    }
    // Scope: null (or absent) opens every workspace; a list opens those.
    // Nobody can hand out more than they hold.
    let workspaces: string[] | null = null;
    if (Array.isArray(body.workspaces)) {
      workspaces = body.workspaces.filter((w): w is string => typeof w === "string");
      const have = listWorkspaces(tenant).map((w) => w.name);
      const unknown = workspaces.filter((w) => !have.includes(w));
      if (unknown.length) throw new ApiError(`no such workspace: ${unknown.join(", ")}`, 400);
      if (actor.workspaces && workspaces.some((w) => !actor.workspaces!.includes(w))) throw new ApiError("you can only share workspaces you can open", 403);
    } else if (actor.workspaces) {
      throw new ApiError("you are scoped to some workspaces, so an invite must name which", 403);
    }
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(`"${email}" is not an email address`, 400);
    const invite = await mintInvite(tenant, role, { workspaces, email, by: { id: actor.id, email: actor.name, role: actor.role, workspaces: actor.workspaces } });
    const path = `/signup?invite=${encodeURIComponent(invite.token)}`;
    // The same origin the reset and verify mails use: FOLDRUN_PUBLIC_URL,
    // else the request's own. Built from x-forwarded-host with an http://
    // default, this mailed an http:// link to whatever host header a
    // client chose to send.
    const origin = publicOrigin(req);
    let sent: { ok: true } | { ok: false; error: string } | null = null;
    if (email && body.send !== false) {
      sent = await sendInviteEmail(tenant, email, `${origin}${path}`, { from: actor.name, role, scope: describeScope(workspaces), expires: invite.expires });
    }
    if (invite.superseded.length) {
      await audit("member.invite_revoked", { actor: actor.name, tenant, subject: email, detail: { invites: invite.superseded, reason: "superseded by a newer invite to the same address" } });
    }
    await audit("member.invited", { actor: actor.name, tenant, subject: email, detail: { inviteId: invite.id, role, workspaces, email, sent: sent?.ok ?? null, superseded: invite.superseded } });
    return NextResponse.json({
      ok: true,
      id: invite.id,
      role,
      workspaces,
      email,
      path,
      expires: invite.expires.toISOString(),
      sent: sent ? sent.ok : null,
      sendError: sent && !sent.ok ? sent.error : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
