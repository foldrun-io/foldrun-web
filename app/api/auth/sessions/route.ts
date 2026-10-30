// The sessions you are signed in on, and ending them.
//
// GET  lists your live sessions, marking the one making the request.
// DELETE ends them: one by id, or every OTHER one — never the device asking,
//        because signing yourself out while trying to secure your account is
//        a surprise, not a security feature.

import { NextRequest, NextResponse } from "next/server";
import { verifySession, sessionIdOf, SESSION_COOKIE } from "@/server/users";
import { listSessions, revokeSession, revokeSessions, revocable } from "@/server/sessions";
import { audit } from "@/server/audit";
import { sessionUser, errorResponse } from "@/server/api";
import { refuseNonText } from "@/server/auth-input";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await verifySession(token);
    if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    if (!revocable()) {
      // Say so rather than returning an empty list, which would read as "you are
      // signed in nowhere" when the truth is "this install cannot tell".
      return NextResponse.json({ revocable: false, current: null, sessions: [] });
    }
    const current = sessionIdOf(token);
    const sessions = await listSessions(user.id);
    return NextResponse.json({
      revocable: true,
      current,
      sessions: sessions.map((s) => ({ ...s, isCurrent: s.id === current })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await sessionUser(req);
    if (user instanceof Response) return user;
    if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    if (!revocable()) {
      return NextResponse.json(
        { error: "this install has no database, so sessions cannot be ended individually" },
        { status: 409 },
      );
    }

    const current = sessionIdOf(token);
    const body = (await req.json().catch(() => ({}))) as { id?: string; others?: boolean };
    const notText = refuseNonText(body, "id");
    if (notText) return notText;

    if (body.others) {
      const n = await revokeSessions(user.id, current ?? undefined);
      await audit("session.revoked", {
        actor: user.email,
        tenant: user.tenant,
        detail: { scope: "others", count: n },
      });
      return NextResponse.json({ ok: true, ended: n });
    }

    if (!body.id) return NextResponse.json({ error: "which session?" }, { status: 400 });
    if (body.id === current) {
      return NextResponse.json(
        { error: "that is this device — use sign out instead" },
        { status: 400 },
      );
    }
    const done = await revokeSession(user.id, body.id);
    if (done) {
      await audit("session.revoked", {
        actor: user.email,
        tenant: user.tenant,
        subject: body.id,
        detail: { scope: "one" },
      });
    }
    return NextResponse.json({ ok: done, ended: done ? 1 : 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
