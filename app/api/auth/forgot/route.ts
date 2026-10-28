// "I forgot my password." Always 200, always the same sentence, whatever the
// address — the form must not be a way to learn which addresses have an
// account. Rate limited per address and per caller for the same reason the
// login is. If there is an account, a reset link goes to it; if the platform
// cannot send mail, the super admin console can hand the link over instead.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/platform/cache";
import { clientIp } from "@/server/limits";
import { findUser } from "@/server/users";
import { audit } from "@/server/audit";
import { resetLink, publicOrigin } from "@/server/auth-flows";
import { sendResetEmail } from "@/server/email";
import { errorResponse } from "@/server/api";

const SAME = { ok: true, message: "If that address has an account, a reset link is on its way." };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    // clientIp honours FOLDRUN_TRUST_PROXY, as login and signup do; reading
    // the header raw let anyone pick a fresh address per request.
    const ip = clientIp(req);
    const byIp = await rateLimit(`forgot:ip:${ip ?? "?"}`, 20, 60 * 60);
    const byEmail = await rateLimit(`forgot:email:${email}`, 3, 60 * 60);
    if (!byIp.allowed || !byEmail.allowed) {
      return NextResponse.json({ error: "too many requests — try again in an hour" }, { status: 429 });
    }
    if (!email) return NextResponse.json(SAME);
    const user = await findUser(email);
    if (user) {
      // Not awaited: waiting on the mail API only when the address has an
      // account made the answer's timing say which addresses do.
      const link = resetLink(publicOrigin(req), user);
      void (async () => {
        const sent = await sendResetEmail(user.tenant, user.email, link, ip);
        await audit("password.reset_requested", { actor: user.email, tenant: user.tenant, detail: { sent: sent.ok, ...(sent.ok ? {} : { error: sent.error }) } });
      })().catch((err) => console.error("forgot: reset mail failed", err instanceof Error ? err.message : err));
    }
    return NextResponse.json(SAME);
  } catch (err) {
    return errorResponse(err);
  }
}
