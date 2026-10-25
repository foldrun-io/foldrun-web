// The moves between a person and their session that need a link or a code:
// mint a reset link, mint a verify link, and the URL they live at. Shared by
// the auth routes and the super admin console (which can hand a customer a
// reset link when mail cannot).

import type { NextRequest } from "next/server";
import { mintToken, hashFingerprint, RESET_TTL_MS, VERIFY_TTL_MS } from "@/server/auth-tokens";
import type { UserRecord } from "@/server/users";

/** This install's own address, as the outside world reaches it — each
 *  environment sets FOLDRUN_PUBLIC_URL (dev.foldrun.io, stage.foldrun.io, a
 *  customer's own host). Null when unset. Never a hard-coded host: a link
 *  built from one sent a staging customer to production. */
export function installOrigin(): string | null {
  return process.env.FOLDRUN_PUBLIC_URL?.trim().replace(/\/+$/, "") || null;
}

/** Where links and redirects point. The install's own address; else, only
 *  behind a proxy the operator trusts (FOLDRUN_TRUST_PROXY=1, as clientIp
 *  reads it), the host that proxy saw; else the request's own origin (a LAN
 *  install). Never a forwarded header a caller could write: an unset
 *  FOLDRUN_PUBLIC_URL would let `X-Forwarded-Host: attacker` put a reset
 *  token in a link to their host (Codex, 18 Oct 2026). And never
 *  `req.nextUrl.origin` where the install has an address: behind the proxy
 *  that is the server's internal one — the confirm-email link landed people
 *  on the server's internal port (18 Oct 2026). */
export function publicOrigin(req: NextRequest): string {
  const own = installOrigin();
  if (own) return own;
  if (process.env.FOLDRUN_TRUST_PROXY === "1") {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (host) return `${req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"}://${host}`;
  }
  return req.nextUrl.origin;
}

/** The host the browser used, where it can be known: what a trusted proxy
 *  (FOLDRUN_TRUST_PROXY=1) saw; else the public origin's host. Not the raw
 *  Host header behind an untrusted proxy chain — that can be an internal
 *  address (the confirm-email link landed on one, 18 Oct 2026), and trusting
 *  it would refuse every connect there. Known limit: without a trusted proxy,
 *  a dashboard opened at another address than the public one is not caught
 *  here; its consent still fails safe at the callback ("another browser"). */
export function browserHost(req: NextRequest): string {
  if (process.env.FOLDRUN_TRUST_PROXY === "1") {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (host) return host;
  }
  return new URL(publicOrigin(req)).host;
}

export function resetLink(origin: string, user: UserRecord): string {
  // Bound to the password as it is now: using the link changes the hash,
  // and the same link then no longer verifies. Single-use without a table.
  const token = mintToken("reset", { u: user.id, h: hashFingerprint(user.hash) }, RESET_TTL_MS);
  return `${origin}/reset?token=${encodeURIComponent(token)}`;
}

export function verifyLink(origin: string, user: UserRecord): string {
  const token = mintToken("verify", { u: user.id, e: user.email }, VERIFY_TTL_MS);
  return `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;
}
