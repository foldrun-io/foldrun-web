// Send the verification link again, to the signed-in person, at most a few
// times an hour.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, errorResponse, ApiError } from "@/server/api";
import { rateLimit } from "@/platform/cache";
import { verifyLink, publicOrigin } from "@/server/auth-flows";
import { sendVerifyEmail } from "@/server/email";
import { isOwner } from "@/server/users";
import { billing } from "@/platform/billing";
import { platform } from "@/lib/platform";

export async function POST(req: NextRequest) {
  try {
    const me = await requireSession(req);
    if (me.emailVerifiedAt) return NextResponse.json({ ok: true, already: true });
    const limit = await rateLimit(`verify:${me.id}`, 3, 60 * 60);
    if (!limit.allowed) throw new ApiError("sent recently — check your inbox, or try again in an hour", 429);
    // Same rule as the first send: the trial line goes only to someone whose
    // confirmation will actually grant it.
    const trialCredits = platform.edition() === "hosted" && (await isOwner(me.tenant, me.id)) ? billing().trialCredits() : undefined;
    const sent = await sendVerifyEmail(me.tenant, me.email, verifyLink(publicOrigin(req), me), { trialCredits });
    if (!sent.ok) throw new ApiError(sent.error, 502);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
