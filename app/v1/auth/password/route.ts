// Change your own password. The session says who you are; the body has to
// prove you know the current one, so a borrowed unlocked browser cannot
// lock the owner out of their own account.
//
// Every OTHER session ends with it. A password is changed because the old
// one is suspected, and a suspected password's sessions are suspect too —
// the reset flow already did this; a change from inside the account did
// not, so the person who prompted the change stayed signed in.

import { errorResponse, sessionUser, refuse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { changePassword, sessionIdOf, SESSION_COOKIE, endSessions } from "@/server/users";
import { revocable } from "@/server/sessions";
import { refuseWhenLimited, clearLimit, clientIp } from "@/server/limits";
import { audit } from "@/server/audit";
import { sendSecurityNotice } from "@/server/email";
import { jsonObject } from "@/server/body";

// Six tries in fifteen minutes: a person mistyping their current password
// never meets it; a stolen session grinding it does.
const LIMIT = { limit: 6, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return refuse("sign in first", 401);

  const limited = await refuseWhenLimited(`password:${user.id}`, LIMIT.limit, LIMIT.windowSec);
  if (limited) return limited;

  // A body that is not a JSON object is refused here, outside any try.

  const read = await jsonObject(req, { optional: true }).catch((err: unknown) => errorResponse(err));

  if (read instanceof Response) return read;

  const body = read as { current?: string; next?: string };
  try {
    await changePassword(user.id, body.current ?? "", body.next ?? "");
    await clearLimit(`password:${user.id}`);
    // All but this one — the browser that asked keeps its session.
    const ended = await endSessions(user.id, sessionIdOf(cookie) ?? undefined);
    await audit("password.changed", { actor: user.email, tenant: user.tenant, detail: { otherSessionsEnded: ended } });
    sendSecurityNotice(user.tenant, user.email, "your password was changed", clientIp(req));
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
