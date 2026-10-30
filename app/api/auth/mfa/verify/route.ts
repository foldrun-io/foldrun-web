// The second step of a sign-in. A challenge (from /api/auth/login) plus a
// six-digit code from the app, or one backup code. Rate limited per user:
// six digits is a million guesses, and five minutes is enough to try them
// without a limit.
//
// The limit alone never ended, though: six guesses every five minutes is
// ~1,700 a day, and someone holding the password could keep it up for
// months unseen (30 Oct 2026). So ten wrong six-digit codes in a row pause
// six-digit codes for the rest of a day, and the person is mailed at their
// own address. Not a lock-out: a backup code still signs in (ten random
// characters, nothing to grind), the pause lifts by itself, and the mail
// says to reset the password — whoever typed the codes had it.

import { NextRequest, NextResponse } from "next/server";
import { readToken } from "@/server/auth-tokens";
import { findUserById, openString, mfaBinding, rebindMfa, consumeBackupCode, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { verifyTotp, hashBackup } from "@/server/totp";
import { rateLimit, rateLimitReset, cache } from "@/platform/cache";
import { audit } from "@/server/audit";
import { listWorkspaces } from "@/lib/store";
import { errorResponse, refuse } from "@/server/api";
import { clientIp } from "@/server/limits";
import { sendSecurityNotice } from "@/server/email";

const PER_USER = { limit: 6, windowSec: 5 * 60 };
// Six-digit codes in a row without a right one, and how long they stay
// paused. Far under NIST 800-63B's 100; far over a person fumbling an app.
const MFA_PAUSE = { after: 10, windowSec: 24 * 60 * 60 };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { challenge?: string; code?: string };
    const claims = readToken("mfa-challenge", String(body.challenge ?? ""));
    if (!claims) return refuse("sign in again", 401);
    const user = await findUserById(claims.u);
    if (!user?.mfaSecret) return refuse("sign in again", 401);

    const limit = await rateLimit(`mfa:${user.id}`, PER_USER.limit, PER_USER.windowSec);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "too many codes — sign in again in a few minutes" },
        { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
      );
    }

    const code = String(body.code ?? "").trim();
    let how: "totp" | "backup" | null = null;
    // A six-digit code is the app's; anything else can only be a backup
    // code (ten characters, letters among them), so the two never mix.
    const sixDigits = /^\d{6}$/.test(code.replace(/\s/g, ""));
    if (sixDigits) {
      // Counts every six-digit try since the last right code; the window
      // starts at the first, so a pause lasts until a day after the streak began.
      const streak = await rateLimit(`mfa:totp:${user.id}`, MFA_PAUSE.after, MFA_PAUSE.windowSec);
      if (!streak.allowed) {
        return NextResponse.json(
          { error: "too many wrong codes in a row — codes from the app are paused for this account for up to a day. Sign in with a backup code, or wait" },
          { status: 429, headers: { "retry-after": String(streak.retryAfter) } },
        );
      }
      if (verifyTotp(openString(user.mfaSecret, mfaBinding(user.id)), code) && (await firstUse(user.id, code))) how = "totp";
      else if (streak.remaining === 0) {
        // The tenth wrong one: say so once, to the address the account has.
        await audit("mfa.locked", { actor: user.email, tenant: user.tenant, detail: { after: MFA_PAUSE.after } });
        sendSecurityNotice(user.tenant, user.email, `${MFA_PAUSE.after} wrong two-step codes in a row were entered after your password, so codes from the app are paused for up to a day (a backup code still signs in)`, clientIp(req));
      }
    } else if (await consumeBackupCode(user.id, hashBackup(code))) how = "backup";
    if (!how) {
      await audit("mfa.refused", { actor: user.email, tenant: user.tenant });
      return refuse("that code is not right", 401);
    }
    await rateLimitReset(`mfa:${user.id}`);
    await rateLimitReset(`mfa:totp:${user.id}`);
    if (how === "totp") await rebindMfa(user.id).catch(() => false);
    const session = await mintSession(user, req.headers.get("user-agent"), { mfa: true });
    await audit("login", { actor: user.email, tenant: user.tenant, subject: session.sessionId, detail: { mfa: how } });
    const res = NextResponse.json({ ok: true, tenant: user.tenant, workspace: listWorkspaces(user.tenant)[0]?.name ?? null, ...(how === "backup" ? { backupUsed: true } : {}) });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * A code signs in once. It stays valid for its 30 s step and one either
 * side, so one seen over a shoulder or phished in real time would work again
 * for about a minute and a half (ASVS 2.8.4). Remembered in Redis for two
 * minutes; an install with no Redis keeps the old behaviour.
 */
async function firstUse(userId: string, code: string): Promise<boolean> {
  const c = cache();
  if (!c) return true;
  try {
    return (await c.set(`totp-used:${userId}:${code.replace(/\s/g, "")}`, "1", "EX", 120, "NX")) === "OK";
  } catch {
    return true; // Redis down: the rate limit above still holds
  }
}
