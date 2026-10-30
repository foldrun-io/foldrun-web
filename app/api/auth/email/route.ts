// Change your own email address.
//
// The session says who you are; the body has to prove you know your
// password, for the same reason the password route does — a borrowed
// unlocked browser must not be able to re-point a login at a stranger's
// inbox. The new address is unverified until it clicks the mail this
// sends, and the OLD address is told, because the person who most needs to
// hear "your login just moved" is the one who no longer receives mail at
// the new one.
//
// Every other session ends with it: a login that moved is a login whose
// old sessions may belong to whoever prompted the move.

import { errorResponse, sessionUser } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { changeEmail, passwordMatches, findUserById, sessionIdOf, SESSION_COOKIE } from "@/server/users";
import { revokeSessions } from "@/server/sessions";
import { refuseWhenLimited, clearLimit } from "@/server/limits";
import { sendVerifyEmail, sendEmailChangedNotice } from "@/server/email";
import { verifyLink, publicOrigin } from "@/server/auth-flows";
import { audit } from "@/server/audit";

// Six tries in fifteen minutes, like the password change: this route
// verifies a password too, and was the one place a stolen session could
// grind it for free.
const LIMIT = { limit: 6, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const limited = await refuseWhenLimited(`email:${user.id}`, LIMIT.limit, LIMIT.windowSec);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { password?: string; email?: string };
  try {
    if (!(await passwordMatches(user.id, body.password ?? ""))) {
      return NextResponse.json({ error: "that is not your password" }, { status: 400 });
    }
    await clearLimit(`email:${user.id}`);
    const moved = await changeEmail(user.id, body.email ?? "");
    const ended = await revokeSessions(user.id, sessionIdOf(cookie) ?? undefined);
    await audit("email.changed", { actor: moved.from, tenant: user.tenant, subject: user.id, detail: { from: moved.from, to: moved.to, otherSessionsEnded: ended } });
    const fresh = await findUserById(user.id);
    const [verify] = await Promise.all([
      fresh ? sendVerifyEmail(user.tenant, moved.to, verifyLink(publicOrigin(req), fresh)) : Promise.resolve({ ok: false as const, error: "no user" }),
      sendEmailChangedNotice(user.tenant, moved.from, moved.to),
    ]);
    return NextResponse.json({ ok: true, from: moved.from, to: moved.to, verificationSent: verify.ok, otherSessionsEnded: ended });
  } catch (err) {
    return errorResponse(err);
  }
}
