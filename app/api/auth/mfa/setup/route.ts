// Start enrolling a second factor: a fresh secret, the otpauth URI the app
// scans, a QR of it, and an enrolment token that carries the secret back to
// /enable — the secret is stored only once a code from the app proves the
// app has it. Nothing on the account changes here.

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireSession, errorResponse } from "@/server/api";
import { newSecret, otpauthUri } from "@/server/totp";
import { mintToken, ENROL_TTL_MS } from "@/server/auth-tokens";
import { sealString } from "@/server/users";

export async function POST(req: NextRequest) {
  try {
    const me = await requireSession(req);
    const secret = newSecret();
    const uri = otpauthUri(secret, me.email);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
    // Sealed inside the token too: a token is a bearer thing that passes
    // through the browser, and the secret must not be readable from it.
    const enrol = mintToken("mfa-enrol", { u: me.id, s: sealString(secret) }, ENROL_TTL_MS);
    return NextResponse.json({ secret, uri, qr, enrol });
  } catch (err) {
    return errorResponse(err);
  }
}
