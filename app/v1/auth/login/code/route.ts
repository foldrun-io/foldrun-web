// Sign in with an emailed code, step one (FOL-185): email me a code.
//
//   POST /v1/auth/login/code { email }  → 200 { ok: true }, always
//
// The answer is the same for every address and comes back before any work is
// done: the lookup and the mail run after the response, so neither the words
// nor the time say whether the address has an account (the same stance as
// /v1/auth/forgot). The browser gets a challenge cookie; the code mailed
// works only with it. A browser that already holds one keeps it, so a second
// ask within 30 seconds does not strand the code already mailed. The design
// is in server/login-codes.ts.

import { NextRequest, NextResponse, after } from "next/server";
import { rateLimit } from "@/platform/cache";
import { clientIp } from "@/server/limits";
import { errorResponse, refuse } from "@/server/api";
import { refuseNonText } from "@/server/auth-input";
import { opsError } from "@/lib/ops-log.ts";
import { CHALLENGE, CHALLENGE_COOKIE, CODE_MS, codeSignInAvailable, newChallenge, requestCode } from "@/server/login-codes";
import { sessionCookieOptions } from "@/server/users";
import { jsonObject } from "@/server/body";

const EMAIL = /^[^@\s:,]+@[^@\s:,]+\.[^@\s:,]+$/;
/** Codes mailed per address, per caller, and in all, an hour. Over any of them
 *  the answer is the same 200 and nothing is sent (a 429 would say the address
 *  was asked about before). An address is counted per caller (a stranger
 *  spending his six must not use up the owner's), with a higher ceiling across
 *  callers; where no caller can be told, the address alone, six. */
const PER_ADDRESS = { limit: 6, windowSec: 3600 };
const PER_ADDRESS_ALL_CALLERS = { limit: 30, windowSec: 3600 };
const PER_IP = { limit: 20, windowSec: 3600 };
const INSTALL = { limit: 300, windowSec: 3600 };

/** What the route started after its answer, so a test can wait for it. */
export const inflight = new Set<Promise<unknown>>();

function later(work: () => Promise<void>): void {
  const run = () => work().catch((err) => opsError("auth.login_code_request_failed", err));
  try {
    after(run);
  } catch {
    // Outside a request scope (a test calling the handler directly).
    const p = run().finally(() => inflight.delete(p));
    inflight.add(p);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!codeSignInAvailable()) return refuse("signing in with an emailed code is not available on this install", 404);
    const body = (await jsonObject(req, { optional: true })) as { email?: string };
    const notText = refuseNonText(body, "email");
    if (notText) return notText;
    const email = (body.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return refuse("enter an email address", 400);
    const held = req.cookies.get(CHALLENGE_COOKIE)?.value ?? "";
    const challenge = CHALLENGE.test(held) ? held : newChallenge();
    const ip = clientIp(req);
    later(async () => {
      if (ip && !(await rateLimit(`login-code:ip:${ip}`, PER_IP.limit, PER_IP.windowSec)).allowed) return;
      const byAddress = ip ? `login-code:addr-ip:${email}:${ip}` : `login-code:addr:${email}`;
      if (!(await rateLimit(byAddress, PER_ADDRESS.limit, PER_ADDRESS.windowSec)).allowed) return;
      if (ip && !(await rateLimit(`login-code:addr-all:${email}`, PER_ADDRESS_ALL_CALLERS.limit, PER_ADDRESS_ALL_CALLERS.windowSec)).allowed) return;
      // The install-wide cap is charged only for a real account (inside
      // requestCode, after the lookup): an address nobody holds never spends
      // it, so one client cannot use it up with made-up ones.
      await requestCode(email, challenge, Date.now(), async () => (await rateLimit("login-code:sends", INSTALL.limit, INSTALL.windowSec)).allowed);
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CHALLENGE_COOKIE, challenge, {
      ...sessionCookieOptions(req, new Date(Date.now() + CODE_MS + 5 * 60_000)),
      path: "/v1/auth/login/code",
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
