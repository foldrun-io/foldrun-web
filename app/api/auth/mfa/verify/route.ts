// The second step of a sign-in. A challenge (from /api/auth/login) plus a
// six-digit code from the app, or one backup code. Rate limited per user:
// six digits is a million guesses, and five minutes is enough to try them
// without a limit.

import { NextRequest, NextResponse } from "next/server";
import { readToken } from "@/server/auth-tokens";
import { findUserById, openString, consumeBackupCode, mintSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
import { verifyTotp, hashBackup } from "@/server/totp";
import { rateLimit, rateLimitReset } from "@/platform/cache";
import { audit } from "@/server/audit";
import { listWorkspaces } from "@/lib/store";
import { errorResponse } from "@/server/api";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { challenge?: string; code?: string };
    const claims = readToken("mfa-challenge", String(body.challenge ?? ""));
    if (!claims) return NextResponse.json({ error: "sign in again" }, { status: 401 });
    const user = await findUserById(claims.u);
    if (!user?.mfaSecret) return NextResponse.json({ error: "sign in again" }, { status: 401 });

    const limit = await rateLimit(`mfa:${user.id}`, 6, 5 * 60);
    if (!limit.allowed) return NextResponse.json({ error: "too many codes — sign in again in a few minutes" }, { status: 429 });

    const code = String(body.code ?? "").trim();
    let how: "totp" | "backup" | null = null;
    if (verifyTotp(openString(user.mfaSecret), code)) how = "totp";
    else if (await consumeBackupCode(user.id, hashBackup(code))) how = "backup";
    if (!how) {
      await audit("mfa.refused", { actor: user.email, tenant: user.tenant });
      return NextResponse.json({ error: "that code is not right" }, { status: 401 });
    }
    await rateLimitReset(`mfa:${user.id}`);
    const session = await mintSession(user, req.headers.get("user-agent"));
    await audit("login", { actor: user.email, tenant: user.tenant, subject: session.sessionId, detail: { mfa: how } });
    const res = NextResponse.json({ ok: true, tenant: user.tenant, workspace: listWorkspaces(user.tenant)[0]?.name ?? null, ...(how === "backup" ? { backupUsed: true } : {}) });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
