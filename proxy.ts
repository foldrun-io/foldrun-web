// The dashboard's front door. Pages render whatever tenant the URL names,
// which was fine when the only URLs came from `next dev` — and is an open
// door the day the dashboard faces the internet. This proxy makes the
// session cookie the authority: whatever `?tenant=` a request carries is
// overwritten with the signed-in user's own account before any page sees
// it, so the page code — which still reads searchParams — cannot be lied
// to, and did not have to change.
//
// API routes authenticate per-request in resolveTenant (Bearer key, or the
// same session cookie); the one thing they get here is the cross-site
// check, because it has to sit in front of every write route at once.

import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, hasUsers } from "@/server/users";
import { crossSiteWrite } from "@/server/csrf";
import { bodyTooLarge } from "@/server/body-limit";
import { apiGate } from "@/server/api-limits";
import { RESOLVED_VERSION_HEADER } from "@/server/api-version";
import { versionHeaders } from "@/server/release";

/** X-Foldrun-Version (and X-Foldrun-Api, X-Foldrun-Cli) on a response, so any
 *  client — the CLI's update notice, a script, a support ticket's curl -i —
 *  can see what it is talking to without a second request. */
function stamped(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(versionHeaders())) res.headers.set(k, v);
  return res;
}

/**
 * Routes that serve bytes behind their own locked `Content-Security-Policy`
 * (`default-src 'none'; sandbox`) and `nosniff`: the storage download, the
 * run archive and the browser theater, avatars, and the token-gated approve
 * page. Their headers are deliberate — the blanket policy below would only
 * add noise, and `X-Frame-Options: DENY` could break an embedded preview —
 * so they are left exactly as they are. (`/s/<token>` share links are not
 * under this proxy's matcher, so they need no mention here.)
 */
function selfHardened(pathname: string): boolean {
  if (pathname.startsWith("/api/avatars/") || pathname.startsWith("/api/approve/")) return true;
  const m = pathname.match(/^\/api\/workspaces\/[^/]+\/(.+)$/);
  if (!m) return false;
  return m[1] === "storage/download" || /^runs\/[^/]+\/(archive|live)$/.test(m[1]);
}

/** Served over TLS — directly, or behind the tunnel/nginx edge that sets
 *  x-forwarded-proto (server/users.ts reads the same signal). HSTS is only
 *  meaningful then; a browser ignores it over http anyway. */
function overHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https" || req.nextUrl.protocol === "https:";
}

/**
 * The dashboard's baseline response hardening, on every page and every API
 * response the proxy returns — except the self-hardened byte routes above.
 *
 * X-Frame-Options and the CSP's frame-ancestors are the clickjacking fence;
 * nosniff, Referrer-Policy and Permissions-Policy are the usual floor; HSTS
 * only over TLS. The CSP is **Report-Only** for now: a strict policy that
 * reports a violation rather than blocking it, so turning it on breaks no
 * page while we read what it would refuse. A per-request nonce is minted and
 * forwarded to the app on `x-nonce` (below), so inline scripts can be tagged
 * before the policy is ever enforced.
 */
function harden(res: NextResponse, req: NextRequest, nonce: string): NextResponse {
  if (selfHardened(req.nextUrl.pathname)) return res;
  const h = res.headers;
  h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // This host only: includeSubDomains would bind every name under it to
  // HTTPS for a year, which a dashboard header has no business deciding.
  if (overHttps(req)) h.set("Strict-Transport-Security", "max-age=31536000");
  h.set(
    "Content-Security-Policy-Report-Only",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  return res;
}

/** An unpredictable per-request token for the CSP nonce. randomUUID is in
 *  both the node and edge runtimes a middleware may run in. */
function makeNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function proxy(req: NextRequest) {
  const nonce = makeNonce();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    // A cookie-carrying write from an origin that is not ours. SameSite=Lax
    // is the first layer; this is the second, and it refuses before any
    // handler runs. Bearer requests and requests with no Origin pass.
    const why = crossSiteWrite(req);
    if (why) return harden(stamped(NextResponse.json({ error: why }, { status: 403 })), req, nonce);
    // Over the limit Next would hand the route a truncated body, silently
    // (server/body-limit.ts). Refuse it whole instead.
    const tooBig = bodyTooLarge(req.headers.get("content-length"));
    if (tooBig) return harden(stamped(NextResponse.json({ error: tooBig }, { status: 413 })), req, nonce);
    // API version, rate limit, deprecation — server/api-limits.ts.
    const gate = await apiGate(req);
    const forwarded = new Headers(req.headers);
    forwarded.delete(RESOLVED_VERSION_HEADER);
    for (const [k, v] of Object.entries(gate.requestHeaders)) forwarded.set(k, v);
    const res = gate.refuse ?? NextResponse.next({ request: { headers: forwarded } });
    for (const [k, v] of Object.entries(gate.headers)) res.headers.set(k, v);
    return harden(stamped(res), req, nonce);
  }

  // Local development trusts the URL, exactly as the API's dev fallback
  // trusts the x-foldrun-tenant header. Only `next dev` sets this.
  if (process.env.FOLDRUN_DEV_NO_AUTH === "1") return harden(NextResponse.next(), req, nonce);

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    // An install with no users yet goes to signup, not a login it can't pass.
    const to = req.nextUrl.clone();
    to.pathname = (await hasUsers()) ? "/login" : "/signup";
    to.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return harden(NextResponse.redirect(to), req, nonce);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  const url = req.nextUrl.clone();
  url.searchParams.set("tenant", user.tenant);
  return harden(NextResponse.rewrite(url, { request: { headers: requestHeaders } }), req, nonce);
}

export const config = {
  matcher: ["/dashboard/:path*", "/dashboard", "/api/:path*"],
};
