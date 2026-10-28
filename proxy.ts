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
import { crossSiteWrite, jsonOnly } from "@/server/csrf";
import { bodyTooLarge } from "@/server/body-limit";
import { apiGate } from "@/server/api-limits";
import { RESOLVED_VERSION_HEADER } from "@/server/api-version";
import { versionHeaders } from "@/server/release";
import { consoleRoute } from "@/server/surface";

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
 * so they are left exactly as they are — and so are `/s/<token>` share
 * links, which the proxy has seen since its matcher took every path (27 Oct
 * 2026) and which set their own headers.
 */
function selfHardened(pathname: string): boolean {
  if (pathname.startsWith("/api/avatars/") || pathname.startsWith("/api/approve/") || pathname.startsWith("/s/")) return true;
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
 * only over TLS. The CSP is **enforced** (28 Oct 2026): a per-request nonce
 * goes into the policy, and the same policy rides on the request (forward()
 * below), which is where Next reads the nonce to tag its own scripts — every
 * page is rendered per request for that reason, the docs and help included.
 * FOLDRUN_CSP=report-only is the way back: the policy is then only reported.
 */
function harden(res: NextResponse, req: NextRequest, nonce: string): NextResponse {
  if (selfHardened(req.nextUrl.pathname)) return res;
  const h = res.headers;
  h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // No other site's window may hold a reference to ours, and our responses
  // are not loaded by other sites (27 Oct 2026, ZAP 90004).
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-site");
  // This host only: includeSubDomains would bind every name under it to
  // HTTPS for a year, which a dashboard header has no business deciding.
  if (overHttps(req)) h.set("Strict-Transport-Security", "max-age=31536000");
  h.set(process.env.FOLDRUN_CSP === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", csp(nonce));
  return res;
}

/** The page policy. Scripts only with this request's nonce, and what those
 *  load ('strict-dynamic'); `next dev` also needs eval, production never. */
function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** The request as the app sees it: the nonce, and the policy Next reads it
 *  from (it takes the nonce out of the request's CSP header). */
function forward(req: NextRequest, nonce: string, from: Headers = req.headers): Headers {
  const h = new Headers(from);
  h.set("x-nonce", nonce);
  h.set("content-security-policy", csp(nonce));
  return h;
}

/** An unpredictable per-request token for the CSP nonce. randomUUID is in
 *  both the node and edge runtimes a middleware may run in. */
function makeNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function proxy(req: NextRequest) {
  const nonce = makeNonce();
  // An operator console's host answers first (hosted only: foldrun-admin's
  // server/surface.ts; the public stub has no console and answers nothing).
  const onConsole = await consoleRoute(req, {
    pass: () => harden(NextResponse.next({ request: { headers: forward(req, nonce) } }), req, nonce),
    answer: (res) => harden(res, req, nonce),
  });
  if (onConsole) return onConsole;
  if (!req.nextUrl.pathname.startsWith("/api/") && !/^\/dashboard(\/|$)/.test(req.nextUrl.pathname)) {
    // Every other page (sign-in, signup, reset, the home page): no session
    // logic, but the same security headers as the dashboard. Until 27 Oct
    // 2026 they got none — the quality stack's ZAP scan found a frameable
    // sign-in page with no CSP, nosniff or Permissions-Policy.
    return harden(NextResponse.next({ request: { headers: forward(req, nonce) } }), req, nonce);
  }
  if (req.nextUrl.pathname.startsWith("/api/")) {
    // A cookie-carrying write from an origin that is not ours — or a write
    // to a sign-in route, cookie or not. SameSite=Lax is the first layer;
    // this is the second, and it refuses before any handler runs. Bearer
    // requests and non-browser requests (no Origin, no Sec-Fetch-Site) pass.
    const why = crossSiteWrite(req);
    if (why) return harden(stamped(NextResponse.json({ error: why }, { status: 403 })), req, nonce);
    // Those sign-in routes take JSON only, which no HTML form can send.
    const notJson = jsonOnly(req);
    if (notJson) return harden(stamped(NextResponse.json({ error: notJson }, { status: 415 })), req, nonce);
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
  if (process.env.FOLDRUN_DEV_NO_AUTH === "1") return harden(NextResponse.next({ request: { headers: forward(req, nonce) } }), req, nonce);

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    // An install with no users yet goes to signup, not a login it can't pass.
    const to = req.nextUrl.clone();
    to.pathname = (await hasUsers()) ? "/login" : "/signup";
    to.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return harden(NextResponse.redirect(to), req, nonce);
  }

  const requestHeaders = forward(req, nonce);
  const url = req.nextUrl.clone();
  url.searchParams.set("tenant", user.tenant);
  return harden(NextResponse.rewrite(url, { request: { headers: requestHeaders } }), req, nonce);
}

export const config = {
  // Every page and route (27 Oct 2026): a console's host must be able to
  // refuse anything that is not the console. Static assets stay out.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
