// The other end of the reset link. The token names the user and the
// password as it was; a changed password, an expired link or a forged one
// all fail the same way. On success every session of theirs is ended and
// the new password signs them in fresh — unless they have a second factor:
// a reset link proves only the inbox, so it must not stand in for the code
// (27 Oct 2026; it used to mint the session either way). They sign in, and
// the login asks for the code.
//
// FOL-316: the link is redeemed in one transaction (server/users.ts
// redeemReset): two uses at once give one reset, and the password, the
// verified address and the end of every session land together. A sign-in
// waiting for its second factor was bound to the old password and must
// start again (app/v1/auth/mfa/verify).

import { NextRequest, NextResponse } from "next/server";
import { readToken, hashFingerprint } from "@/server/auth-tokens";
import { findUserById, redeemReset, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { assertPasswordPolicy } from "@/server/password-policy";
import { audit } from "@/server/audit";
import { errorResponse, ApiError } from "@/server/api";
import { sendSecurityNotice } from "@/server/email";
import { clientIp } from "@/server/limits";
import { jsonObject } from "@/server/body";

const INVALID = "that link is not valid — it may have expired or been used";

export async function POST(req: NextRequest) {
  try {
    const body = (await jsonObject(req, { optional: true })) as { token?: string; password?: string };
    const claims = readToken("reset", String(body.token ?? ""));
    if (!claims) throw new ApiError(INVALID, 400);
    const user = await findUserById(claims.u);
    if (!user || hashFingerprint(user.hash) !== claims.h || claims.e !== user.email) throw new ApiError(INVALID, 400);
    const password = String(body.password ?? "");
    // An unconfirmed address: whatever the login made before anyone proved the
    // inbox ends first, so a failure here leaves the link unspent (FOL-317).
    const started = new Date();
    const provisional = !user.emailVerifiedAt ? (await import("@/server/provisional")).revokeProvisional : null;
    if (provisional) {
      await assertPasswordPolicy(password, user.email);
      await provisional(user, started);
    }
    // Checked again and written in one transaction under the users lock:
    // the password, the address verified, every session ended.
    const done = await redeemReset({ u: claims.u, h: claims.h, e: claims.e }, password);
    if (!done) throw new ApiError(INVALID, 400);
    // Again, now the old password is gone: an app exchange that slipped in
    // between is caught here, and none can follow (its code carries the old
    // password's fingerprint).
    if (provisional && done.confirmedNow) await provisional(user, done.resetAt);
    await audit("password.reset", { actor: user.email, tenant: user.tenant });
    sendSecurityNotice(user.tenant, user.email, "your password was reset", clientIp(req));
    // Read again, not the snapshot: a second factor turned on meanwhile is still owed.
    const fresh = (await findUserById(user.id)) ?? done;
    if (fresh.mfaSecret) return NextResponse.json({ ok: true, account: user.tenant, signIn: true });
    const session = await mintSession(fresh, req.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true, account: user.tenant });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
