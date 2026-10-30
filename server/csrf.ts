// The second lock on the door against cross-site requests.
//
// The first is the session cookie's SameSite=Lax: a browser on another
// site does not send it with a POST. This is the layer for when that is
// not enough — an old browser, a cookie attribute lost behind a proxy, a
// subdomain that turned out to be somebody else's. A browser always sends
// Origin on a cross-site state-changing request and never lets a page
// forge it, so a request that carries our cookie, changes something, and
// names an origin that is not ours can only be one thing.
//
// Where a browser sends no Origin, Sec-Fetch-Site says the same thing, and
// is read instead (every current browser sends it; a page cannot set it).
//
// What it does NOT touch: a request on a Bearer key (the CLI, curl — no
// cookie, no browser, no forgery to guard against) and a request with
// neither header (a non-browser client, which is why SameSite stays the
// first layer rather than this one).
//
// The routes anyone may write to without a credential — signing in, the
// second factor, signing up, a reset, the forgot form, the CLI's sign-in
// request — are checked with or without a cookie (FOL-103, login CSRF), and
// take JSON only (jsonOnly): an HTML form cannot send that, so a page on
// another site cannot post one of them at all, Origin or no Origin.

import { SESSION_COOKIE } from "./users.ts";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Writes open to anyone (no credential yet), and the one that approves a
 *  CLI sign-in from a session. Every caller of these is our own page or the
 *  CLI, and every one sends JSON. */
const OPEN_WRITES = /^\/api\/(?:auth\/(?:login|signup|reset|forgot|mfa\/verify)|cli\/(?:login|authorize))\/?$/;

function openWritePath(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return OPEN_WRITES.test(new URL(url, "http://local").pathname);
  } catch {
    return false;
  }
}

/**
 * Why a write to one of the open routes is refused for its body's type, or
 * null. JSON only: a browser form can send only urlencoded, multipart or
 * text/plain — and a text/plain body can be valid JSON, which the routes'
 * req.json() read whatever the type said. The proxy answers 415.
 */
export function jsonOnly(req: { method: string; headers: Headers; url?: string }): string | null {
  if (!WRITES.has(req.method.toUpperCase()) || !openWritePath(req.url)) return null;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" ? null : "this route takes a JSON body (content-type: application/json)";
}

/** The request's own origin(s), as hosts: FOLDRUN_PUBLIC_URL when set, and
 *  the host the request arrived on — a LAN install has only the latter. */
function ownHosts(headers: Headers, publicUrl: string | undefined): string[] {
  const hosts: string[] = [];
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || headers.get("host")?.trim();
  if (host) hosts.push(host.toLowerCase());
  if (publicUrl) {
    try {
      hosts.push(new URL(publicUrl).host.toLowerCase());
    } catch {
      // an unparseable FOLDRUN_PUBLIC_URL is somebody else's error
    }
  }
  return hosts;
}

/**
 * Why this request must be refused as cross-site, or null when it passes.
 * Pure: the caller decides what a refusal looks like on the wire.
 */
export function crossSiteWrite(
  req: { method: string; headers: Headers; url?: string },
  publicUrl = process.env.FOLDRUN_PUBLIC_URL,
): string | null {
  if (!WRITES.has(req.method.toUpperCase())) return null;
  const authz = req.headers.get("authorization") ?? "";
  if (authz.startsWith("Bearer ")) return null;
  const cookie = req.headers.get("cookie") ?? "";
  // Signing in carries no cookie yet, and is still worth forging: a page
  // that POSTs the attacker's credentials (an enctype=text/plain form is
  // valid JSON) signs the victim into the attacker's account, where they
  // then save their secrets. Those routes get the rule cookie or not.
  if (!openWritePath(req.url) && !new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(cookie)) return null;
  const origin = req.headers.get("origin");
  if (origin === null) {
    // No Origin: a browser still says where the request came from in
    // Sec-Fetch-Site. Neither header: not a browser (the CLI, curl).
    const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
    if (site === "same-site" || site === "cross-site") return `this request came from another site (Sec-Fetch-Site: ${site})`;
    return null;
  }
  // "null" is what a browser sends from a sandboxed frame or a data: page —
  // an origin that is nobody's, and certainly not ours.
  if (origin === "null") return "this request came from an opaque origin";
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return "this request's Origin header is not a URL";
  }
  if (ownHosts(req.headers, publicUrl).includes(host)) return null;
  return `this request came from ${origin}, which is not this install's origin`;
}
