// Exchange a password for a session cookie. One generic refusal for a wrong
// password and an unknown email — the difference is nobody's business.

import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/server/limits";
import { verifyPassword, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { listWorkspaces } from "@/lib/store";
import { rateLimit, rateLimitReset } from "@/platform/cache";
import { audit } from "@/server/audit";
import { mintToken, CHALLENGE_TTL_MS } from "@/server/auth-tokens";
import { errorResponse } from "@/server/api";
import { surface, signInRefusal, sessionAudience } from "@/server/surface";

// Two limits, because they answer different attacks. Per-account stops someone
// grinding one person's password; per-IP stops the same client working through
// a list of accounts, which the per-account limit alone never sees. Both are
// generous enough that a person mistyping their own password twice never meets
// them.
const PER_ACCOUNT = { limit: 8, windowSec: 15 * 60 };
const PER_IP = { limit: 40, windowSec: 15 * 60 };


function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "too many attempts — wait a few minutes and try again" },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = (body.email ?? "").toLowerCase().trim();
    const ip = clientIp(req);

    // Checked BEFORE verifyPassword: scrypt is deliberately expensive, so an
    // unlimited login endpoint is also an unlimited way to spend the box's CPU.
    //
    // The per-account limit always applies and is the primary defence — it stops
    // someone grinding one person's password. The per-IP limit only applies when
    // the caller is actually identifiable, because a limit keyed on a shared
    // proxy address throttles every customer at once rather than the attacker.
    if (ip) {
      const byIp = await rateLimit(`login:ip:${ip}`, PER_IP.limit, PER_IP.windowSec);
      if (!byIp.allowed) return tooMany(byIp.retryAfter);
    }
    const byAccount = await rateLimit(`login:acct:${email}`, PER_ACCOUNT.limit, PER_ACCOUNT.windowSec);
    if (!byAccount.allowed) return tooMany(byAccount.retryAfter);

    const user = await verifyPassword(body.email ?? "", body.password ?? "");
    if (!user) {
      // Recorded without the password and without saying whether the account
      // exists — the log is for the account's owner, not for an attacker who
      // gets to read it back.
      await audit("login.refused", { actor: email || "(none)", detail: { reason: "bad-credentials" } });
      return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
    }
    // A correct password clears the account's counter, so someone who mistyped
    // three times and then got it right is not throttled by their own typos.
    await rateLimitReset(`login:acct:${email}`);

    // An operator console lets only the platform's operator in (hosted only:
    // foldrun-admin's server/surface.ts; nobody is refused here otherwise).
    const refused = await signInRefusal(user);
    if (refused) return NextResponse.json({ error: refused }, { status: 403 });
    const here = surface();

    // A second factor is on: the password bought a challenge, not a session.
    // The challenge token names the user and the surface it was asked on, and
    // lasts five minutes; the code goes to /api/auth/mfa/verify, which is
    // where the session is minted — for that surface only.
    if (user.mfaSecret) {
      const challenge = mintToken("mfa-challenge", { u: user.id, a: here }, CHALLENGE_TTL_MS);
      return NextResponse.json({ ok: true, mfa: true, challenge });
    }

    // The surface's audience (an operator console's, when its second factor
    // is optional — hosted only; the customer app's otherwise).
    const session = await mintSession(user, req.headers.get('user-agent'), { audience: sessionAudience() });
    await audit('login', { actor: user.email, tenant: user.tenant, subject: session.sessionId });
    const res = NextResponse.json({
      ok: true,
      tenant: user.tenant,
      // Sign in lands inside a workspace, not on a list of them.
      workspace: listWorkspaces(user.tenant)[0]?.name ?? null,
    });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
