// "I forgot my password." Always 200, always the same sentence, whatever the
// address — the form must not be a way to learn which addresses have an
// account. Rate limited per address, per caller when one can be told, and
// install-wide on the mail it sends — each caller to a share of it. If there is an account, a reset link goes to it; if the platform
// cannot send mail, foldrun's hosted operator can hand the link over instead.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/platform/cache";
import { clientIp } from "@/server/limits";
import { findUser } from "@/server/users";
import { audit } from "@/server/audit";
import { resetLink, publicOrigin } from "@/server/auth-flows";
import { sendResetEmail } from "@/server/email";
import { errorResponse } from "@/server/api";

const SAME = { ok: true, message: "If that address has an account, a reset link is on its way." };

/** Per caller — only when something honest reports one (server/limits.ts
 *  clientIp). Without an address there is no per-caller count at all: one
 *  shared "?" count let anyone use up everybody's resets (FOL-101). */
const PER_IP = { limit: 20, windowSec: 60 * 60 };
/** Per address asked about: the limit every request meets, whoever sends it. */
const PER_EMAIL = { limit: 3, windowSec: 60 * 60 };
/** Reset mails the whole install sends in an hour — the ceiling on what a
 *  flood of addresses can cost. Counted only for mail that would go, so made-up
 *  addresses cannot spend it. Past it the answer is the same sentence and no
 *  mail goes: a 429 there would say the address has an account. */
const INSTALL_SENDS = { key: "forgot:sends", limit: 300, windowSec: 60 * 60 };
/** One caller's share of that ceiling, when a trusted proxy names the
 *  caller. A caller past it gets the same sentence and no mail — and spends
 *  none of the install's, so one caller asking for 100 known addresses × 3
 *  an hour can no longer use up everyone's resets (30 Oct 2026). Without a
 *  caller address nobody can be told apart: set FOLDRUN_TRUST_PROXY. */
const CALLER_SENDS = { limit: 10, windowSec: 60 * 60 };

const tooMany = () => NextResponse.json({ error: "too many requests — try again in an hour" }, { status: 429 });

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    // clientIp honours FOLDRUN_TRUST_PROXY, as login and signup do; reading
    // the header raw let anyone pick a fresh address per request.
    const ip = clientIp(req);
    if (ip && !(await rateLimit(`forgot:ip:${ip}`, PER_IP.limit, PER_IP.windowSec)).allowed) return tooMany();
    if (!email) return NextResponse.json(SAME);
    if (!(await rateLimit(`forgot:email:${email}`, PER_EMAIL.limit, PER_EMAIL.windowSec)).allowed) return tooMany();
    const user = await findUser(email);
    if (user) {
      // Not awaited: waiting on the mail API only when the address has an
      // account made the answer's timing say which addresses do — and the
      // install's hourly cap (FOL-101) is counted in the same background
      // step, so it cannot say it either.
      const link = resetLink(publicOrigin(req), user);
      void (async () => {
        // The caller's own share first, so a caller past it spends nothing
        // of the install's. Silent, like the ceiling: a refusal here would
        // say the address has an account.
        if (ip && !(await rateLimit(`forgot:sends:ip:${ip}`, CALLER_SENDS.limit, CALLER_SENDS.windowSec)).allowed) {
          await audit("password.reset_requested", { actor: user.email, tenant: user.tenant, detail: { sent: false, error: "this caller's hourly share of reset mail was reached" } });
          return;
        }
        if (!(await rateLimit(INSTALL_SENDS.key, INSTALL_SENDS.limit, INSTALL_SENDS.windowSec)).allowed) {
          await audit("password.reset_requested", { actor: user.email, tenant: user.tenant, detail: { sent: false, error: "the install's hourly reset mail limit was reached" } });
          return;
        }
        const sent = await sendResetEmail(user.tenant, user.email, link, ip);
        await audit("password.reset_requested", { actor: user.email, tenant: user.tenant, detail: { sent: sent.ok, ...(sent.ok ? {} : { error: sent.error }) } });
      })().catch((err) => console.error("forgot: reset mail failed", err instanceof Error ? err.message : err));
    }
    return NextResponse.json(SAME);
  } catch (err) {
    return errorResponse(err);
  }
}
