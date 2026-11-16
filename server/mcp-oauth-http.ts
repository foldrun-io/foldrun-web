// What the MCP OAuth routes share: open CORS on the documents and the two
// endpoints an app calls without a person (nothing there reads a cookie), and
// OAuth's own error shape (RFC 6749 §5.2).

import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/platform/cache";
import { OAuthError } from "./mcp-oauth.ts";
import { clientIp } from "./limits.ts";
import { reportError } from "./api.ts";

/** The two open endpoints, per address: registering is rare (an app does it
 *  once), exchanging is a few calls an hour per connection. Over it, OAuth's
 *  own 429 shape with Retry-After. */
export const OPEN_LIMITS = { register: { limit: 30, windowSec: 3600 }, token: { limit: 120, windowSec: 60 } } as const;

export async function openLimit(req: NextRequest, which: keyof typeof OPEN_LIMITS): Promise<NextResponse | null> {
  const { limit, windowSec } = OPEN_LIMITS[which];
  const v = await rateLimit(`mcp-oauth:${which}:${clientIp(req) ?? "unknown"}`, limit, windowSec);
  if (v.allowed) return null;
  return NextResponse.json(
    { error: "slow_down", error_description: `at most ${limit} ${which === "register" ? "registrations an hour" : "token requests a minute"} from one address — retry in ${v.retryAfter}s`, retry_after: v.retryAfter },
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

/**
 * The body of a token or revocation request as the form RFC 6749 names:
 * form-encoded, or a JSON object (its string fields). JSON that does not
 * parse, or parses to anything but an object (`null`, `[]`, `7`), is the
 * caller's mistake — invalid_request, 400 — not a TypeError's 500 (FOL-199:
 * the hosted fuzz run found the token endpoint answering 500).
 */
export async function oauthForm(req: NextRequest): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (!type.includes("application/json")) return new URLSearchParams(raw);
  let o: unknown;
  try {
    o = JSON.parse(raw || "{}");
  } catch {
    throw new OAuthError("invalid_request", "the body is not valid JSON");
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) throw new OAuthError("invalid_request", "the body must be a JSON object, or form-encoded");
  return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string") as [string, string][]);
}

export function oauthError(err: unknown): NextResponse {
  if (err instanceof OAuthError) {
    const headers: Record<string, string> = { ...OPEN_CORS, "cache-control": "no-store" };
    if (err.status === 401) headers["www-authenticate"] = 'Basic realm="foldrun"';
    return NextResponse.json({ error: err.code, error_description: err.message }, { status: err.status, headers });
  }
  // Anything else is ours: logged with its frames (reportError), and the
  // caller gets OAuth's shape with the same words every other route's 500
  // gives — never the error's own message, which may quote what it read.
  const { status, message } = reportError(err);
  return NextResponse.json({ error: status >= 500 ? "server_error" : "invalid_request", error_description: message }, { status, headers: OPEN_CORS });
}
