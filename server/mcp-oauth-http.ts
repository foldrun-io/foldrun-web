// What the MCP OAuth routes share: open CORS on the documents and the two
// endpoints an app calls without a person (nothing there reads a cookie), and
// OAuth's own error shape (RFC 6749 §5.2).

import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/platform/cache";
import { OAuthError } from "./mcp-oauth.ts";
import { clientIp } from "./limits.ts";

/** The two open endpoints, per address: registering is rare (an app does it
 *  once), exchanging is a few calls an hour per connection. Over it, OAuth's
 *  own 429 shape with Retry-After. */
export const OPEN_LIMITS = { register: { limit: 30, windowSec: 3600 }, token: { limit: 120, windowSec: 60 } } as const;

export async function openLimit(req: NextRequest, which: keyof typeof OPEN_LIMITS): Promise<NextResponse | null> {
  const { limit, windowSec } = OPEN_LIMITS[which];
  const v = await rateLimit(`mcp-oauth:${which}:${clientIp(req) ?? "unknown"}`, limit, windowSec);
  if (v.allowed) return null;
  return NextResponse.json(
    { error: "slow_down", error_description: `at most ${limit} ${which === "register" ? "registrations an hour" : "token requests a minute"} from one address — retry in ${v.retryAfter}s` },
    { status: 429, headers: { ...OPEN_CORS, "retry-after": String(v.retryAfter) } },
  );
}

export const OPEN_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "600",
};

export const preflight = () => new NextResponse(null, { status: 204, headers: OPEN_CORS });

export function oauthJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { ...OPEN_CORS, "cache-control": "no-store", pragma: "no-cache" } });
}

export function oauthError(err: unknown): NextResponse {
  if (err instanceof OAuthError) {
    const headers: Record<string, string> = { ...OPEN_CORS, "cache-control": "no-store" };
    if (err.status === 401) headers["www-authenticate"] = 'Basic realm="foldrun"';
    return NextResponse.json({ error: err.code, error_description: err.message }, { status: err.status, headers });
  }
  return NextResponse.json({ error: "server_error", error_description: err instanceof Error ? err.message : String(err) }, { status: 500, headers: OPEN_CORS });
}
