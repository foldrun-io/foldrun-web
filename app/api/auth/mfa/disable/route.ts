// Turn the second factor off. Needs the password AND a current code — a
// stolen session must not be enough to remove the thing that makes a stolen
// password not enough.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, errorResponse, ApiError } from "@/server/api";
import { verifyPassword, openString, setMfa, consumeBackupCode } from "@/server/users";
import { verifyTotp, hashBackup } from "@/server/totp";
import { audit } from "@/server/audit";
import { refuseWhenLimited, clearLimit, clientIp } from "@/server/limits";
import { sendSecurityNotice } from "@/server/email";

// Six in five minutes — the same window the MFA code itself gets. Without
// it, a six-digit code here could be tried at the rate the box allowed.
const LIMIT = { limit: 6, windowSec: 5 * 60 };

export async function POST(req: NextRequest) {
  try {
    const me = await requireSession(req);
    const limited = await refuseWhenLimited(`mfa-disable:${me.id}`, LIMIT.limit, LIMIT.windowSec);
    if (limited) return limited;
    const body = (await req.json().catch(() => ({}))) as { password?: string; code?: string };
    if (!(await verifyPassword(me.email, String(body.password ?? "")))) throw new ApiError("wrong password", 401);
    if (!me.mfaSecret) throw new ApiError("the second factor is not on", 409);
    const code = String(body.code ?? "").trim();
    const ok = verifyTotp(openString(me.mfaSecret), code) || (await consumeBackupCode(me.id, hashBackup(code)));
    if (!ok) throw new ApiError("that code is not right", 401);
    await clearLimit(`mfa-disable:${me.id}`);
    await setMfa(me.id, null);
    await audit("mfa.disabled", { actor: me.email, tenant: me.tenant });
    sendSecurityNotice(me.tenant, me.email, "two-step sign-in was turned off", clientIp(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
