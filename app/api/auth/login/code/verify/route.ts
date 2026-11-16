// Sign in with an emailed code, step two (FOL-185): the code typed back.
//
//   POST /api/auth/login/code/verify { email, code }
//     → 200 { ok, tenant, workspace } and a session cookie, like a password
//       sign-in; or 200 { ok, mfa: true, challenge } when a second factor is
//       on — the code replaces the password, not the second factor, so the
//       challenge goes to /api/auth/mfa/verify as it does after a password.
//     → 401 for every failure, in the same words (wrong, expired, from
//       another browser, locked, no such address, address not verified).
//
// Limited per caller before anything is looked up; the per-code and
// per-address limits are in server/login-codes.ts.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/platform/cache";
import { audit } from "@/server/audit";
import { errorResponse, refuse } from "@/server/api";
import { refuseNonText } from "@/server/auth-input";
import { mintToken, CHALLENGE_TTL_MS } from "@/server/auth-tokens";
import { clientIp, tooManyAttempts } from "@/server/limits";
import { CHALLENGE, CHALLENGE_COOKIE, CODE_FAILED, codeSignInAvailable, verifyCode } from "@/server/login-codes";
import { findUserById, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { listWorkspaces } from "@/lib/store";
import { opsLog } from "@/lib/ops-log.ts";
import { jsonObject } from "@/server/body";

const PER_IP = { limit: 40, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  try {
    if (!codeSignInAvailable()) return refuse("signing in with an emailed code is not available on this install", 404);
    const body = (await jsonObject(req, { optional: true })) as { email?: string; code?: string };
    const notText = refuseNonText(body, "email", "code");
    if (notText) return notText;
    const email = (body.email ?? "").trim().toLowerCase();
    const ip = clientIp(req);
    if (ip) {
      const byIp = await rateLimit(`login-code-verify:ip:${ip}`, PER_IP.limit, PER_IP.windowSec);
      if (!byIp.allowed) {
        return tooManyAttempts(byIp.retryAfter);
      }
    }
    const held = req.cookies.get(CHALLENGE_COOKIE)?.value ?? "";
    const challenge = CHALLENGE.test(held) ? held : "";
    const verdict = await verifyCode(email, body.code ?? "", challenge);
    if (!verdict.ok) {
      // On the logs, never awaited and never naming the address: the answer's
      // timing must not say whether the address has an account.
      void audit("login.refused", { actor: email || "(none)", detail: { reason: "bad-code", method: "email-code" } }).catch(() => {});
      opsLog("warn", "auth.refused", { surface: "login-code", reason: verdict.reason, status: 401 });
      return refuse(CODE_FAILED, 401);
    }
    const user = await findUserById(verdict.userId);
    if (!user) return refuse(CODE_FAILED, 401);

    const done = (res: NextResponse) => {
      res.cookies.set(CHALLENGE_COOKIE, "", { ...sessionCookieOptions(req, new Date(0)), path: "/api/auth/login/code", maxAge: 0 });
      return res;
    };
    // A second factor is on: the code bought a challenge, not a session. The
    // challenge remembers how the person got this far, for the audit and the
    // session list.
    if (user.mfaSecret) {
      const challengeToken = mintToken("mfa-challenge", { u: user.id, m: "email-code" }, CHALLENGE_TTL_MS);
      return done(NextResponse.json({ ok: true, mfa: true, challenge: challengeToken }));
    }
    const session = await mintSession(user, req.headers.get("user-agent"), { method: "email-code" });
    await audit("login", { actor: user.email, tenant: user.tenant, subject: session.sessionId, detail: { method: "email-code" } });
    const res = NextResponse.json({ ok: true, tenant: user.tenant, workspace: listWorkspaces(user.tenant)[0]?.name ?? null });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return done(res);
  } catch (err) {
    return errorResponse(err);
  }
}
