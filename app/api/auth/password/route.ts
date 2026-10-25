// Change your own password. The session says who you are; the body has to
// prove you know the current one, so a borrowed unlocked browser cannot
// lock the owner out of their own account.
//
// Every OTHER session ends with it. A password is changed because the old
// one is suspected, and a suspected password's sessions are suspect too —
// the reset flow already did this; a change from inside the account did
// not, so the person who prompted the change stayed signed in.

import { errorResponse, sessionUser } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { verifySession, changePassword, sessionIdOf, SESSION_COOKIE } from "@/server/users";
import { revokeSessions, revocable } from "@/server/sessions";
import { refuseWhenLimited, clearLimit } from "@/server/limits";
import { audit } from "@/server/audit";

// Six tries in fifteen minutes: a person mistyping their current password
// never meets it; a stolen session grinding it does.
const LIMIT = { limit: 6, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const limited = await refuseWhenLimited(`password:${user.id}`, LIMIT.limit, LIMIT.windowSec);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  try {
    await changePassword(user.id, body.current ?? "", body.next ?? "");
    await clearLimit(`password:${user.id}`);
    // All but this one — the browser that asked keeps its session.
    const ended = await revokeSessions(user.id, sessionIdOf(cookie) ?? undefined);
    await audit("password.changed", { actor: user.email, tenant: user.tenant, detail: { otherSessionsEnded: ended } });
    return NextResponse.json({
      ok: true,
      otherSessionsEnded: ended,
      message: revocable()
        ? ended === 0
          ? "Changed. No other browser was signed in."
          : `Changed. ${ended === 1 ? "One other browser was" : `${ended} other browsers were`} signed out.`
        : "Changed. This install cannot end other browsers' sessions; they stay signed in until they expire.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
