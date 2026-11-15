// Sign in with an emailed code (FOL-185): the other way in beside the password.
//
// Step one mails a six-digit code to an address that has a verified login;
// step two takes it back from the same browser and answers like a password
// sign-in does (a session, or a challenge when a second factor is on). The
// code replaces the password, never the second factor.
//
// The design is the operator console's (foldrun-admin, 12 Nov 2026, reviewed),
// ported here because that code is private and this is public:
//
//   - six digits from crypto.randomInt, kept only as an HMAC under the install
//     key over the person, the browser's challenge and the code (login_codes
//     holds nothing a search over a million codes could open)
//   - ten minutes, used once, one per 30 s per browser, at most eight live per
//     person; usable only once the mail was accepted
//   - bound to a challenge cookie in the browser that asked: a guess from
//     another browser is not a guess at this code, so it neither counts nor
//     can succeed
//   - five wrong guesses spend that code; 100 wrong in a row, across codes,
//     lock code sign-in for fifteen minutes (users.code_failed_run /
//     code_locked_until, written under a lock on the user's row, so the count
//     holds whichever pod the guesses hit). The password path never reads it.
//   - one answer, in words and in time, whether or not the address has an
//     account, a verified address, a code, or a lock
//
// Only an address that was proven reachable may use it, and a code sign-in
// never marks an address verified: someone who signed up with another
// person's address must not be able to turn that person's code into a
// verification of their own account.

import crypto from "node:crypto";
import { databaseEnabled, tx, users as usersTable, loginCodes, and, eq, lt, sql } from "@/platform/orm";
import { opsError } from "@/lib/ops-log.ts";
import { installKey } from "../../foldrun-core/src/webhook.ts";
import { platformSend } from "@/server/email";

/** How long an emailed code works. */
export const CODE_MS = 10 * 60_000;
/** One code per browser per this long. */
export const RESEND_MS = 30_000;
/** Wrong guesses one code survives; the fifth spends it. */
export const MAX_WRONG = 5;
/** Wrong guesses in a row, across codes, that lock code sign-in (NIST 800-63B's ceiling). */
export const LOCK_AFTER = 100;
export const LOCK_MS = 15 * 60_000;
/** Live codes one person may have at once (a browser each); past it nothing new is issued. */
export const MAX_LIVE = 8;

const EMAIL = /^[^@\s:,]+@[^@\s:,]+\.[^@\s:,]+$/;
/** What the challenge cookie holds: 32 random bytes, base64url. */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const CHALLENGE_COOKIE = "foldrun_login_challenge";
/** The one answer to every failed code (wrong, expired, other browser, locked,
 *  no such address, address not verified), so the step says no more than the
 *  request did. */
export const CODE_FAILED = "that code didn't work. Check it, or send a new one.";

/** Is emailed-code sign-in on here? It needs the database (the codes and the
 *  counts live there, as revocable sessions do) and a mail credential. */
export function codeSignInAvailable(): boolean {
  return databaseEnabled() && Boolean(process.env.FOLDRUN_RESEND_API_KEY?.trim());
}

export const newChallenge = () => crypto.randomBytes(32).toString("base64url");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const normEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

/** A code as it is kept. Exported for tests. */
export function codeDigest(userId: string, binding: string, code: string): string {
  return crypto.createHmac("sha256", installKey()).update(`foldrun-login-code:${userId}:${binding}:${code}`).digest("hex");
}

type Issued =
  | { user: { id: string; tenant: string; email: string }; code: string; binding: string }
  | { why: "no address" | "not verified" | "locked" | "too soon" | "busy" };

/** Make a code for this address and browser, or say why not. Nothing leaves
 *  this module but the result; the caller mails it and then marks it sent. */
export async function issueCode(email: string, challenge: string, now = Date.now()): Promise<Issued> {
  const e = normEmail(email);
  if (!EMAIL.test(e) || e.length > 254 || !CHALLENGE.test(challenge)) return { why: "no address" };
  const binding = sha(challenge);
  return tx(async (t) => {
    const [u] = await t.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${e}`).for("update").limit(1);
    if (!u) return { why: "no address" as const };
    if (!u.emailVerifiedAt) return { why: "not verified" as const };
    if (u.codeLockedUntil && u.codeLockedUntil.getTime() > now) return { why: "locked" as const };
    // What expired more than one throttle ago is of no use to anyone.
    await t.delete(loginCodes).where(and(eq(loginCodes.userId, u.id), lt(loginCodes.expiresAt, new Date(now - RESEND_MS))));
    const mine = await t.select().from(loginCodes).where(eq(loginCodes.userId, u.id));
    const here = mine.find((r) => r.binding === binding);
    if (here && now - here.issuedAt.getTime() < RESEND_MS) return { why: "too soon" as const };
    const others = mine.filter((r) => r.binding !== binding && r.expiresAt.getTime() > now);
    if (others.length >= MAX_LIVE) return { why: "busy" as const };
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const row = {
      userId: u.id,
      binding,
      digest: codeDigest(u.id, binding, code),
      issuedAt: new Date(now),
      expiresAt: new Date(now + CODE_MS),
      wrong: 0,
      sent: false,
    };
    await t
      .insert(loginCodes)
      .values({ id: crypto.randomBytes(12).toString("hex"), ...row })
      .onConflictDoUpdate({ target: [loginCodes.userId, loginCodes.binding], set: row });
    return { user: { id: u.id, tenant: u.tenant, email: u.email }, code, binding };
  });
}

/** The mail was accepted: the code may now be used. It was not: the code is
 *  emptied, so a refused mail never leaves a code anyone could guess at. */
async function markSent(userId: string, binding: string, sent: boolean, now: number): Promise<void> {
  await tx(async (t) => {
    const where = and(eq(loginCodes.userId, userId), eq(loginCodes.binding, binding));
    await t.update(loginCodes).set(sent ? { sent: true } : { digest: "", expiresAt: new Date(now) }).where(where);
  });
}

/** Mail it. The code is in the body only, never the subject, never logged. */
async function mailCode(tenant: string, to: string, code: string): Promise<boolean> {
  const res = await platformSend(
    tenant,
    to,
    "Your foldrun sign-in code",
    `Your foldrun sign-in code is ${code}\n\n` +
      `It works for 10 minutes, once, in the browser where you asked for it.\n` +
      `If you did not ask for it, ignore this email: nobody can sign in with it without being in that browser.\n`,
  );
  if (!res.ok) opsError("auth.login_code_not_sent", new Error(res.error));
  return res.ok;
}

/** Step one, after the answer was given: issue and mail. Never throws; says
 *  nothing back (the route answered the same for every address already). */
export async function requestCode(email: string, challenge: string, now = Date.now()): Promise<"sent" | "not sent"> {
  const out = await issueCode(email, challenge, now);
  if ("why" in out) return "not sent";
  const sent = await mailCode(out.user.tenant, out.user.email, out.code);
  await markSent(out.user.id, out.binding, sent, now);
  return sent ? "sent" : "not sent";
}

export type Verdict =
  | { ok: true; userId: string }
  | { ok: false; reason: "wrong" | "expired" | "locked" | "not verified" | "no such address" };

/** Step two: the code typed back from the browser that asked. Right: spent,
 *  the run of wrong codes cleared. Wrong: counted. The caller answers every
 *  `ok: false` with CODE_FAILED; the reason is for the log only. */
export async function verifyCode(email: string, code: string, challenge: string, now = Date.now()): Promise<Verdict> {
  const e = normEmail(email);
  const c = String(code ?? "").replace(/\s/g, "");
  const bound = CHALLENGE.test(challenge) ? challenge : "";
  if (!EMAIL.test(e) || e.length > 254 || !bound) {
    // The same HMAC a real check does, so the time says nothing either.
    codeDigest("none", bound || "none", c.slice(0, 12));
    return { ok: false, reason: "no such address" };
  }
  const binding = sha(bound);
  return tx(async (t): Promise<Verdict> => {
    const [u] = await t.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${e}`).for("update").limit(1);
    if (!u) {
      codeDigest("none", bound, c.slice(0, 12));
      return { ok: false, reason: "no such address" };
    }
    // Worked out before any early return, so a locked, unverified or empty
    // address takes as long to answer as a live one.
    const [row] = await t.select().from(loginCodes).where(and(eq(loginCodes.userId, u.id), eq(loginCodes.binding, binding))).limit(1);
    const mine = codeDigest(u.id, binding, c);
    if (!u.emailVerifiedAt) return { ok: false, reason: "not verified" };
    if (u.codeLockedUntil && u.codeLockedUntil.getTime() > now) return { ok: false, reason: "locked" };
    if (!row || !row.sent || !row.digest || row.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
    const good = /^\d{6}$/.test(c) && mine.length === row.digest.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(row.digest));
    const where = and(eq(loginCodes.userId, u.id), eq(loginCodes.binding, binding));
    if (good) {
      // A spent row stays (no digest, expired now) until its 30 s throttle ends.
      await t.update(loginCodes).set({ digest: "", expiresAt: new Date(now) }).where(where);
      await t.update(usersTable).set({ codeFailedRun: 0, codeLockedUntil: null }).where(eq(usersTable.id, u.id));
      return { ok: true, userId: u.id };
    }
    const run = u.codeFailedRun + 1;
    if (run >= LOCK_AFTER) {
      await t.update(loginCodes).set({ digest: "", expiresAt: new Date(now) }).where(eq(loginCodes.userId, u.id));
      await t.update(usersTable).set({ codeFailedRun: 0, codeLockedUntil: new Date(now + LOCK_MS) }).where(eq(usersTable.id, u.id));
      return { ok: false, reason: "locked" };
    }
    const wrong = row.wrong + 1;
    await t.update(loginCodes).set(wrong >= MAX_WRONG ? { wrong, digest: "", expiresAt: new Date(now) } : { wrong }).where(where);
    await t.update(usersTable).set({ codeFailedRun: run }).where(eq(usersTable.id, u.id));
    return { ok: false, reason: "wrong" };
  });
}
