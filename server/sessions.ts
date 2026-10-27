// Sessions as rows, so they can be ended.
//
// They used to be signed statements and nothing else: verifiable by anyone
// holding the install key, forgeable by nobody without it — and revocable by
// no one at all. A stolen cookie stayed valid until it expired, and the only
// kill switch was rotating FOLDRUN_SECRET_KEY, which signs out every person on
// the install. "Sign out my other devices" is table stakes and it needs a row.
//
// The token still carries an HMAC, so a forged id is rejected without touching
// the database. The row decides whether a GENUINE id is still allowed. Both
// checks matter: the signature stops fabrication, the row stops a valid token
// outliving the moment its owner ended it.
//
// TWO FORMATS, on purpose:
//
//   v2.<sessionId>.<expiry>.<hmac>   a row exists; revocable
//   v1.<userId>.<expiry>.<hmac>      the pre-database form; still accepted
//
// v1 is still verified so that deploying this does not sign everybody out, and
// still minted when an install has no database — which is what a self-hoster
// on a laptop gets, and what the platform falls back to if Postgres is down.

import crypto from "node:crypto";
import { orm, databaseEnabled, sessions, and, desc, eq, gt, isNull, ne, sql } from "@/platform/orm";

const SESSION_DAYS = 30;

export interface SessionRow {
  id: string;
  userId: string;
  tenant: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

/** Write the row a v2 token refers to. */
export async function recordSession(
  id: string,
  userId: string,
  tenant: string,
  expires: Date,
  userAgent: string | null,
  how: { audience?: string | null; mfa?: boolean } = {},
): Promise<void> {
  const q = orm();
  if (!q) return;
  await q
    .insert(sessions)
    .values({
      id,
      userId,
      tenant,
      expiresAt: expires,
      userAgent: userAgent?.slice(0, 300) ?? null,
      audience: how.audience ?? null,
      mfaAt: how.mfa ? new Date() : null,
    })
    .onConflictDoNothing({ target: sessions.id });
}

/**
 * Is this session id still allowed?
 *
 * Returns the user id when it is. Without a database every v2 id is refused
 * rather than accepted: a token that claims to be revocable, checked against
 * nothing, is worse than one that never claimed it — and this only happens if
 * the database disappears after v2 tokens were minted, where refusing means a
 * re-login and accepting would mean revocation silently stopped working.
 */
export async function sessionAllowed(id: string): Promise<{ userId: string; audience: string | null; mfa: boolean } | null> {
  const q = orm();
  if (!q) return null;
  const rows = await q
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .returning({ userId: sessions.userId, audience: sessions.audience, mfaAt: sessions.mfaAt });
  return rows[0] ? { userId: rows[0].userId, audience: rows[0].audience ?? null, mfa: rows[0].mfaAt !== null } : null;
}

/** Every live session for a person, newest first — what the profile lists. */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const q = orm();
  if (!q) return [];
  const rows = await q
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    tenant: r.tenant,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    userAgent: r.userAgent,
  }));
}

/**
 * End sessions. `keep` is the one making the request, so "sign out my other
 * devices" does not sign out the device asking.
 *
 * Revoked rather than deleted: a session that ended is a fact an audit answer
 * may need, and DELETE would take the evidence with it.
 */
export async function revokeSessions(userId: string, keep?: string): Promise<number> {
  const q = orm();
  if (!q) return 0;
  const rows = await q
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), keep ? ne(sessions.id, keep) : undefined))
    .returning({ id: sessions.id });
  return rows.length;
}

/** End one session by id, only if it belongs to this person. */
export async function revokeSession(userId: string, id: string): Promise<boolean> {
  const q = orm();
  if (!q) return false;
  const rows = await q
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** A fresh session id. 32 bytes, so it is unguessable on its own even before
 *  the signature is checked. */
export function newSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

/** Whether this install can issue revocable sessions at all. */
export function revocable(): boolean {
  return databaseEnabled();
}
