// Finish enrolling: the enrolment token from /setup and one code from the
// app. The code proves the app holds the secret; only then is it stored,
// sealed, with eight backup codes returned exactly once.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, errorResponse, ApiError } from "@/server/api";
import { readToken } from "@/server/auth-tokens";
import { verifyTotp, newBackupCodes, hashBackup } from "@/server/totp";
import { openString, setMfa } from "@/server/users";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest) {
  try {
    const me = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as { enrol?: string; code?: string };
    const claims = readToken("mfa-enrol", String(body.enrol ?? ""));
    if (!claims || claims.u !== me.id) throw new ApiError("start again — the enrolment expired", 400);
    const secret = openString(claims.s);
    if (!verifyTotp(secret, String(body.code ?? ""))) throw new ApiError("that code is not right — check the app's clock and try again", 400);
    const backup = newBackupCodes();
    await setMfa(me.id, { secret, backupHashes: backup.map(hashBackup) });
    await audit("mfa.enabled", { actor: me.email, tenant: me.tenant });
    return NextResponse.json({ ok: true, backup });
  } catch (err) {
    return errorResponse(err);
  }
}
