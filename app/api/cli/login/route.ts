// `foldrun login`, step one: the CLI asks for a code.
//
// Open on purpose — there is no credential yet; that is what is being made.
// The answer names the page the person confirms on, so the CLI can print it
// for a machine with no browser.

import { NextRequest, NextResponse } from "next/server";
import { beginCliLogin, requestOrigin, POLL_SECONDS } from "@/server/cli-login";
import { errorResponse } from "@/server/api";
import { clientIp, refuseWhenLimited } from "@/server/limits";
import { publicOrigin } from "@/server/auth-flows";

/** Sign-in requests one caller may open in a window: far above a person
 *  retrying `foldrun login`, far below the install's 200 waiting. */
const PER_IP = { limit: 10, windowSec: 10 * 60 };

/** Whose count a request lands in. An address: its own. No address behind
 *  Cloudflare with an edge secret set: the request did not come through our
 *  zone (a person's always does — the edge stamps every one), so all such
 *  requests share one count, which no person ever lands in. No address
 *  anywhere else (no trusted proxy, or no secret): nothing reports the
 *  caller, so a shared count would lock every person out together — leave
 *  it to the install-wide cap, as before. */
function callerKey(ip: string | null): string | null {
  if (ip) return `cli-login:ip:${ip}`;
  const edge = process.env.FOLDRUN_TRUST_PROXY === "cloudflare" && !!process.env.FOLDRUN_EDGE_SECRET;
  return edge ? "cli-login:unstamped" : null;
}

export async function POST(req: NextRequest) {
  try {
    // Open to anyone, and the install keeps at most 200 requests waiting:
    // without a per-caller limit one client could hold all 200 and lock
    // every person out of `foldrun login` (FOL-94). The caller as signup and
    // login read it — the trusted proxy's word, never a raw header.
    const key = callerKey(clientIp(req));
    if (key) {
      const limited = await refuseWhenLimited(key, PER_IP.limit, PER_IP.windowSec);
      if (limited) return limited;
    }
    const body = (await req.json().catch(() => ({}))) as { hostname?: string };
    // Where it came from, for the approval page (RFC 8628 §5.4).
    const row = await beginCliLogin(String(body.hostname ?? ""), requestOrigin(req));
    const origin = publicOrigin(req);
    return NextResponse.json({
      id: row.id,
      code: row.code,
      verifyUrl: `${origin}/cli/authorize?code=${row.code}`,
      expiresAt: row.expiresAt,
      interval: POLL_SECONDS,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
