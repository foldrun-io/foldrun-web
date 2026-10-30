// Signed, single-purpose, short-lived tokens for the moments between a
// person and their session: a reset link, a verification link, the second
// step of a sign-in, an MFA enrolment in progress.
//
// `kind.payload.expires.sig`, HMAC over all of it under the install key —
// the same scheme invites use. Nothing is stored: a token is valid iff it
// verifies and has not expired, and for the ones that must be single-use
// the payload carries a fingerprint of the state they change, so the act of
// using one invalidates it (a reset token carries the current password hash;
// once the password changes, the token no longer matches).

import crypto from "node:crypto";
import { installKey } from "../../foldrun-core/src/webhook.ts";

type Kind = "reset" | "verify" | "email-change" | "mfa-challenge" | "mfa-enrol" | "support-handoff";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (s: string) => crypto.createHmac("sha256", installKey()).update(s).digest("hex");

export function mintToken(kind: Kind, payload: Record<string, string>, ttlMs: number): string {
  const expires = Date.now() + ttlMs;
  const body = `${kind}.${b64(JSON.stringify(payload))}.${expires}`;
  return `${body}.${sign(body)}`;
}

export function readToken(kind: Kind, token: string): Record<string, string> | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== kind) return null;
  const [k, p, e, sig] = parts;
  const body = `${k}.${p}.${e}`;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(e) < Date.now()) return null;
  try {
    return JSON.parse(unb64(p)) as Record<string, string>;
  } catch {
    return null;
  }
}

/** A fingerprint of a password hash, for binding a reset token to "the
 *  password as it was when this was sent". Not the hash itself. */
export const hashFingerprint = (hash: string) => crypto.createHash("sha256").update(hash).digest("hex").slice(0, 16);

export const RESET_TTL_MS = 30 * 60 * 1000;
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const ENROL_TTL_MS = 10 * 60 * 1000;

