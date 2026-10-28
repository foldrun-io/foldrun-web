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
// What it does NOT touch: a request on a Bearer key (the CLI, curl — no
// cookie, no browser, no forgery to guard against) and a request with no
// Origin at all (same-site navigations and non-browser clients, which is
// why SameSite stays the first layer rather than this one).

import { SESSION_COOKIE } from "./users.ts";
import { consoleWrite } from "./surface.ts";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SIGN_IN = /^\/api\/auth\/(?:login|signup|reset|mfa\/verify)\/?$/;

function signInPath(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return SIGN_IN.test(new URL(url, "http://local").pathname);
  } catch {
    return false;
  }
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
  // An operator console has its own, stricter rule (hosted only:
  // foldrun-admin's server/surface.ts); undefined means this is no console.
  const onConsole = consoleWrite(req);
  if (onConsole !== undefined) return onConsole;
  const authz = req.headers.get("authorization") ?? "";
  if (authz.startsWith("Bearer ")) return null;
  const cookie = req.headers.get("cookie") ?? "";
  // Signing in carries no cookie yet, and is still worth forging: a page
  // that POSTs the attacker's credentials (an enctype=text/plain form is
  // valid JSON) signs the victim into the attacker's account, where they
  // then save their secrets. Those routes get the Origin rule cookie or not.
  if (!signInPath(req.url) && !new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(cookie)) return null;
  const origin = req.headers.get("origin");
  if (origin === null) return null;
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
