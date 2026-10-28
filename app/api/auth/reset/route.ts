// The other end of the reset link. The token names the user and the
// password as it was; a changed password, an expired link or a forged one
// all fail the same way. On success every session of theirs is ended and
// the new password signs them in fresh — unless they have a second factor:
// a reset link proves only the inbox, so it must not stand in for the code
// (27 Oct 2026; it used to mint the session either way). They sign in, and
// the login asks for the code.

import { NextRequest, NextResponse } from "next/server";
import { readToken, hashFingerprint } from "@/server/auth-tokens";
import { findUserById, resetPassword, mintSession, sessionCookieOptions, setEmailVerified, SESSION_COOKIE } from "@/server/users";
import { audit } from "@/server/audit";
import { errorResponse, ApiError } from "@/server/api";
import { sendSecurityNotice } from "@/server/email";
import { clientIp } from "@/server/limits";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
    const claims = readToken("reset", String(body.token ?? ""));
    if (!claims) throw new ApiError("that link is not valid — it may have expired or been used", 400);
    const user = await findUserById(claims.u);
    if (!user || hashFingerprint(user.hash) !== claims.h || claims.e !== user.email) {
      throw new ApiError("that link is not valid — it may have expired or been used", 400);
    }
    await resetPassword(user.id, String(body.password ?? ""));
    // Clicking a link that only that inbox received proves the inbox.
    await setEmailVerified(user.id);
    await audit("password.reset", { actor: user.email, tenant: user.tenant });
    sendSecurityNotice(user.tenant, user.email, "your password was reset", clientIp(req));
    const fresh = (await findUserById(user.id))!;
    if (fresh.mfaSecret) return NextResponse.json({ ok: true, account: user.tenant, signIn: true });
    const session = await mintSession(fresh, req.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true, account: user.tenant });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
