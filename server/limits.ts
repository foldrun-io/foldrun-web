// The one rate-limit refusal, for the routes that take a password.
//
// Login and the MFA code had it; the password change, the email change and
// the MFA switch-off did not, and each of those verifies a password too —
// so a stolen session could grind the password against them at no cost.
// Same counter (platform cache: Redis, or in-process without it), same
// 429, same header.

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, rateLimitReset } from "@/platform/cache";

/** Refuse when a key has been hit too often in a window; else null. */
export async function refuseWhenLimited(key: string, limit: number, windowSec: number): Promise<NextResponse | null> {
  const verdict = await rateLimit(key, limit, windowSec);
  if (verdict.allowed) return null;
  return NextResponse.json(
    { error: "too many attempts — wait a few minutes and try again" },
    { status: 429, headers: { "retry-after": String(verdict.retryAfter) } },
  );
}

/** A right answer clears the counter, so one's own typos never throttle
 *  the attempt that finally got it right. */
export const clearLimit = rateLimitReset;

/**
 * The caller's address, or null when we cannot honestly tell.
 *
 * This is not paranoia, it is measured: behind k3s's klipper load balancer
 * every request arrives from a cluster pod address (10.42.x), so keying a
 * limit on it would count all customers as one client and lock everybody out
 * together the moment a handful of logins failed. A per-IP limit is only
 * meaningful when something in front of us reports the real caller.
 *
 * x-forwarded-for is trusted ONLY when FOLDRUN_TRUST_PROXY is set, because a
 * header anyone can send is a way to evade the limit, not enforce it.
 *
 * FOLDRUN_TRUST_PROXY=cloudflare reads cf-connecting-ip, which Cloudflare's
 * edge writes over whatever the client sent — never x-forwarded-for, whose
 * first entry is the client's own say-so (FOL-94). That holds only for a
 * request that came through OUR zone, and an address of Cloudflare's proves
 * nothing: anyone's Worker can call an origin directly and set the header
 * itself (Codex, 27 Oct 2026). So the request must also carry x-foldrun-edge
 * equal to FOLDRUN_EDGE_SECRET, which a request header rule in our zone sets
 * at the edge (foldrun-infra dev/cloudflare/transform-rules.json). No secret,
 * an empty one, or no stamp: no address — the limits fall back to what they
 * key on without one, as before. Only the address is read from headers; links
 * come from FOLDRUN_PUBLIC_URL (auth-flows.ts), never a forwarded host here.
 */
export function clientIp(req: Pick<NextRequest, "headers">): string | null {
  if (process.env.FOLDRUN_TRUST_PROXY === "cloudflare") {
    const secret = process.env.FOLDRUN_EDGE_SECRET ?? "";
    if (!sameSecret(req.headers.get("x-foldrun-edge"), secret)) return null;
    return req.headers.get("cf-connecting-ip")?.trim() || null;
  }
  if (process.env.FOLDRUN_TRUST_PROXY === "1") {
    // First hop is the client; the rest are proxies appending themselves.
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return null;
}

/** The edge stamp against the secret, in constant time for equal lengths. */
function sameSecret(got: string | null, secret: string): boolean {
  if (!got || !secret) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
