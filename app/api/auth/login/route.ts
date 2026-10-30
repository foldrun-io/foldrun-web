// Exchange a password for a session cookie. One generic refusal for a wrong
// password and an unknown email — the difference is nobody's business.

import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/server/limits";
import { verifyPassword, findUser, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { sendSecurityNotice } from "@/server/email";
import { listWorkspaces } from "@/lib/store";
import { rateLimit, rateLimitReset } from "@/platform/cache";
import { audit } from "@/server/audit";
import { mintToken, CHALLENGE_TTL_MS } from "@/server/auth-tokens";
import { errorResponse } from "@/server/api";
import { refuseNonText } from "@/server/auth-input";

// Limits, because they answer different attacks. Per-account stops someone
// grinding one person's password; per-IP stops the same client working through
// a list of accounts, which the per-account limit alone never sees. All are
// generous enough that a person mistyping their own password twice never meets
// them.
//
// When a trusted proxy names the caller, the per-account count is per
// account AND caller (30 Oct 2026): it used to be keyed on the typed address
// alone, so anyone could lock a known person out of password sign-in for good
// by failing as them eight times every quarter hour. Now a stranger failing
// as someone locks out only themselves; the person, signing in from their own
// address, still gets in. Behind it, a ceiling over every caller — five times
// as high — stops a guesser spread over many addresses, and reaching it mails
// the person once, so a lockout that does happen is one they hear about. This
// is OWASP's account-plus-source throttling; device cookies would be the next
// step. With no caller address (no FOLDRUN_TRUST_PROXY) nobody can be told
// apart and the count stays per account, as before.
const PER_ACCOUNT = { limit: 8, windowSec: 15 * 60 };
const PER_ACCOUNT_ALL_CALLERS = { limit: 40, windowSec: 15 * 60 };
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
    const notText = refuseNonText(body, "email", "password");
    if (notText) return notText;
    const email = (body.email ?? "").toLowerCase().trim();
    const ip = clientIp(req);

    // Checked BEFORE verifyPassword: scrypt is deliberately expensive, so an
    // unlimited login endpoint is also an unlimited way to spend the box's CPU.
    //
    // The per-account limit always applies and is the primary defence — it stops
    // someone grinding one person's password. The per-IP limit only applies when
    // the caller is actually identifiable, because a limit keyed on a shared
    // proxy address throttles every customer at once rather than the attacker.
    // The per-account key: this account from this caller when one can be
    // told, else this account from anyone.
    const accountKey = ip ? `login:acct-ip:${email}:${ip}` : `login:acct:${email}`;
    let ceilingReached = false;
    if (ip) {
      const byIp = await rateLimit(`login:ip:${ip}`, PER_IP.limit, PER_IP.windowSec);
      if (!byIp.allowed) return tooMany(byIp.retryAfter);
    }
    const byAccount = await rateLimit(accountKey, PER_ACCOUNT.limit, PER_ACCOUNT.windowSec);
    if (!byAccount.allowed) return tooMany(byAccount.retryAfter);
    if (ip) {
      const all = await rateLimit(`login:acct-all:${email}`, PER_ACCOUNT_ALL_CALLERS.limit, PER_ACCOUNT_ALL_CALLERS.windowSec);
      if (!all.allowed) return tooMany(all.retryAfter);
      ceilingReached = all.remaining === 0;
    }

    const user = await verifyPassword(body.email ?? "", body.password ?? "");
    if (!user) {
      // Recorded without the password and without saying whether the account
      // exists — the log is for the account's owner, not for an attacker who
      // gets to read it back.
      await audit("login.refused", { actor: email || "(none)", detail: { reason: "bad-credentials" } });
      if (ceilingReached) {
        // The last try every caller together has this quarter hour: tell the
        // person, if there is one. Not awaited, so the answer's timing says
        // nothing about whether the address has an account.
        void (async () => {
          const who = await findUser(email);
          if (!who) return;
          await audit("login.throttled", { actor: who.email, tenant: who.tenant, detail: { after: PER_ACCOUNT_ALL_CALLERS.limit } });
          sendSecurityNotice(who.tenant, who.email, `${PER_ACCOUNT_ALL_CALLERS.limit} sign-ins with a wrong password were tried in a quarter hour from several addresses, so password sign-in is paused for up to fifteen minutes`, ip);
        })().catch((err) => console.error("login: throttle notice failed", err instanceof Error ? err.message : err));
      }
      return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
    }
    // A correct password clears this caller's counter, so someone who mistyped
    // three times and then got it right is not throttled by their own typos.
    // The ceiling over every caller is not cleared: a person signing in must
    // not hand a spread-out guesser a fresh forty.
    await rateLimitReset(accountKey);

    // A second factor is on: the password bought a challenge, not a session.
    // The challenge token names the user and lasts five minutes; the code
    // goes to /api/auth/mfa/verify, which is where the session is minted.
    if (user.mfaSecret) {
      const challenge = mintToken("mfa-challenge", { u: user.id }, CHALLENGE_TTL_MS);
      return NextResponse.json({ ok: true, mfa: true, challenge });
    }

    const session = await mintSession(user, req.headers.get('user-agent'));
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
