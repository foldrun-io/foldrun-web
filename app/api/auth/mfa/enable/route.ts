// Finish enrolling: the enrolment token from /setup and one code from the
// app. The code proves the app holds the secret; only then is it stored,
// sealed, with eight backup codes returned exactly once.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, errorResponse, ApiError } from "@/server/api";
import { readToken } from "@/server/auth-tokens";
import { verifyTotp, newBackupCodes, hashBackup } from "@/server/totp";
import { openString, setMfa, mfaEnrolBinding } from "@/server/users";
import { audit } from "@/server/audit";
import { sendSecurityNotice } from "@/server/email";
import { clientIp } from "@/server/limits";

export async function POST(req: NextRequest) {
  try {
    const me = await requireSession(req);
    // Replacing a live second factor is turning it off and on again, and
    // turning it off needs the password and a code. Without this, a stolen
    // session swapped in its own secret and backup codes with neither.
    if (me.mfaSecret) throw new ApiError("the second factor is already on — turn it off first (that needs your password and a code)", 409);
    const body = (await req.json().catch(() => ({}))) as { enrol?: string; code?: string };
    const claims = readToken("mfa-enrol", String(body.enrol ?? ""));
    if (!claims || claims.u !== me.id) throw new ApiError("start again — the enrolment expired", 400);
    const secret = openString(claims.s, mfaEnrolBinding(me.id));
    if (!verifyTotp(secret, String(body.code ?? ""))) throw new ApiError("that code is not right — check the app's clock and try again", 400);
    const backup = newBackupCodes();
    await setMfa(me.id, { secret, backupHashes: backup.map(hashBackup) });
    await audit("mfa.enabled", { actor: me.email, tenant: me.tenant });
    sendSecurityNotice(me.tenant, me.email, "two-step sign-in was turned on", clientIp(req));
    return NextResponse.json({ ok: true, backup });
  } catch (err) {
    return errorResponse(err);
  }
}
