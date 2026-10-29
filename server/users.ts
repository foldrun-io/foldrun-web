// Users and sessions. A user is a row in `<dataRoot>/users.json` (0600,
// beside keys.json); a session is a signed statement, not a stored one —
// `v1.<userId>.<expires>.<hmac>` under the install key, so there is no
// session table to sweep and restarting the server signs nobody out.
//
// One user owns one tenant. Teams arrive by adding a memberships list to
// this file, not by redesigning it.
//
// Passwords are scrypt (node:crypto, per-user salt). Signup bootstraps the
// same way API keys do: the first user is free, every later one needs
// FOLDRUN_OPEN_SIGNUP=1 — a personal install stays personal by default, and
// the hosted platform, which wants strangers, sets the flag.

import { ensureTenantKey } from "@/platform/tenant-keys.ts";
import { assertPasswordPolicy } from "@/server/password-policy";
import { allUsersDb, upsertUserDb, importUsersToDatabase } from "@/platform/users-db";
import { tx, databaseEnabled, users as usersTable, eq, sql, type Db } from "@/platform/orm";
import { revokeSessions } from "./sessions";
import fs from "node:fs";
import {
  newSessionId,
  recordSession,
  revocable,
  sessionAllowed,
  sessionExpiry,
} from "./sessions";
import path from "node:path";
import crypto from "node:crypto";
import { dataRoot } from "@/lib/paths.ts";
import { assertSafeName, accountDir, ensureAccountFiles } from "@/lib/store.ts";
import { installKey } from "@/lib/webhook.ts";
import { sessionMac } from "./session-mac.ts";
import { isOwner as isOwnerOf, ownerOf as ownerOfMembers } from "@/platform/ownership.ts";
import { assertSignupAllowed } from "@/platform/signup.ts";
import {
  assertCanChangeRole,
  assertCanRemoveMember,
  assertCanTransfer,
  can,
  isRole,
  outranks,
  roleOf as roleOfMembers,
  type Role,
} from "@/platform/permissions.ts";
import {
  claimInviteDb,
  insertInviteDb,
  inviteByIdDb,
  invitesOfTenantDb,
  inviteStatus,
  readInvitesFile,
  revokeInvitesDb,
  writeInvitesFile,
  type InviteRow,
  type InviteStatus,
} from "@/platform/invites.ts";

const usersFile = () => path.join(dataRoot(), "users.json");

export interface UserRecord {
  id: string;
  email: string;
  tenant: string;
  salt: string;
  hash: string; // scrypt(password, salt)
  createdAt: string;
  /** How they want to be addressed. Optional, both halves: an account is
   *  opened with an email and nothing else, and a person who never fills
   *  these in is still shown by email everywhere. Kept as two fields, not
   *  one, because "first name" is what a greeting and a signature want and
   *  splitting a single string later guesses wrong for half the world. */
  firstName?: string | null;
  lastName?: string | null;
  /** IANA zone this person reads timestamps in. Absent means automatic —
   *  whatever their browser reports, which is right for almost everyone and
   *  needs no setting. Present only when they overrode it. */
  timezone?: string | null;
  /**
   * The one who owns this account. There is exactly one, and only they may
   * remove a member.
   *
   * Before this existed, every member was equally powerful: `removeMember`
   * guarded only "the last member stays", so an invitee could delete the
   * person who created the account, kept the workspaces and pays the bill.
   * An invite is the cheapest thing on the platform to hand out, which is
   * what made that the sharpest edge in it.
   *
   * Deliberately a boolean, not a role table. Two states — owns it, or does
   * not — is the whole of what is decided; a permission matrix would be
   * inventing distinctions nobody has asked for and would be much harder to
   * take back.
   *
   * Absent on accounts created before this field, which is why nothing reads
   * it directly: `ownerOf` falls back to the earliest member, who is the
   * founder on every account that exists. That keeps the fix a code change
   * rather than a data migration over live accounts.
   */
  owner?: boolean;
  /**
   * What this member may do — see permissions.ts for the table. Absent on
   * members from before roles existed, who read as `admin`: the power they
   * had. The owner's role is never stored; it is derived from `owner`.
   */
  role?: Role;
  /**
   * Which workspaces this member may open. Absent or null: all of them,
   * which is what every member had before scopes existed. A list: those
   * only — the account's overview, runs, search and switchers show just
   * those, and the API refuses the rest. The owner is never scoped.
   */
  workspaces?: string[] | null;
  /** When the address was proven reachable. Absent on accounts from before
   *  verification existed and on any that never clicked the link. */
  emailVerifiedAt?: string | null;
  /** The TOTP secret, sealed under the install key — never the base32. */
  mfaSecret?: string | null;
  /** sha256 of each unused backup code. */
  mfaBackup?: string[] | null;
  mfaEnabledAt?: string | null;
  /** Set only on a support view's session (never stored; hosted only):
   *  support reading this account as its owner sees it, read-only, until
   *  expiresAt. Every write is refused while it is set — server/auth.ts and
   *  server/api.ts ask server/view-as.ts. */
  viewAs?: { id: string; by: string; reason: string; expiresAt: string } | null;
  /** How the presented token was made (27 Oct 2026): its kind, the surface
   *  it was made for (null = the customer app) and whether a second factor
   *  was completed. Set by verifySession; the console accepts only a v2
   *  "admin" session with mfa. */
  session?: { kind: "v1" | "v2" | "s1"; audience: string | null; mfa: boolean };
  /** A person's own small settings: `onboardingDismissedAt`, and the like. */
  prefs?: Record<string, unknown> | null;
}

// A string sealed under the install key: AES-256-GCM, iv.tag.ciphertext,
// tag length pinned. For the one secret a user row holds that must not be
// readable from a dump of the table — the second factor.
const GCM = { authTagLength: 16 } as const;
const installKeyBytes = () => crypto.createHash("sha256").update(installKey()).digest();
//
// Bound to whose it is (29 Oct 2026, OWASP review): `bind` (e.g. ["foldrun-mfa",
// userId]) is sealed in as AAD, and the result carries an "s2." prefix ("."
// is not base64url, so the forms cannot be confused). One person's sealed
// secret copied onto another's row, or an enrol token's secret planted as a
// stored one, no longer opens. Written once the install writes bound records
// (FOLDRUN_VAULT_WRITE_BOUND=1); the unbound form is read always.
export const mfaBinding = (userId: string) => ["foldrun-mfa", userId];
export const mfaEnrolBinding = (userId: string) => ["foldrun-mfa-enrol", userId];
const S2 = "s2.";
export function sealString(plain: string, bind?: string[]): string {
  const bound = bind !== undefined && process.env.FOLDRUN_VAULT_WRITE_BOUND === "1";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", installKeyBytes(), iv, GCM);
  if (bound) c.setAAD(Buffer.from(JSON.stringify(bind), "utf8"));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const body = Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
  return bound ? S2 + body : body;
}
export function openString(sealed: string, bind?: string[]): string {
  const bound = sealed.startsWith(S2);
  if (bound && bind === undefined) throw new Error("a bound secret needs its binding to open");
  const raw = Buffer.from(bound ? sealed.slice(S2.length) : sealed, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", installKeyBytes(), raw.subarray(0, 12), GCM);
  d.setAuthTag(raw.subarray(12, 28));
  if (bound) d.setAAD(Buffer.from(JSON.stringify(bind), "utf8"));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
/** Whether a stored second factor is still in the unbound form. */
export const isUnboundSeal = (sealed: string) => !sealed.startsWith(S2);

// The store: rows when this install has a database, the file when it does
// not. The array shape is kept on purpose — every mutation below reads the
// people, changes one or two, and writes them back, and that code is the
// part with the security rules in it (who may remove whom, who may hand the
// account over). Changing the storage without touching those rules is the
// whole point of the seam. In database mode a write-back is one transaction:
// upsert what is here, delete what is not. Small N; per-row writes are the
// optimisation for a day this list is long.
//
// Every change goes through mutateUsers: one at a time (a Postgres advisory
// lock, or a queue in this process for the file), against a read taken
// UNDER that lock, writing back only the rows that changed. Before 29 Oct
// each mutation read everyone, then upserted everyone — so any member's
// name or timezone write could put back another person's old password,
// role, MFA secret or removed membership from a snapshot a moment stale.

/** The file — still the fallback, still what a backup carries. Exported so
 *  the boot import can hand it to the database once. */
export function readUsersFile(): UserRecord[] {
  if (!fs.existsSync(usersFile())) return [];
  return JSON.parse(fs.readFileSync(usersFile(), "utf8"));
}

async function readUsers(): Promise<UserRecord[]> {
  if (databaseEnabled()) return (await allUsersDb()) as UserRecord[];
  return readUsersFile();
}

// Any constant both web and console agree on; it names the users table's lock.
const USERS_LOCK = 0x666f6c75;
let fileQueue: Promise<unknown> = Promise.resolve();

/**
 * The team's invites, as a mutation sees them: under the same lock and in
 * the same transaction as the people, so accepting one and creating the
 * member it lets in land together or not at all. With a database these are
 * statements on the transaction; without one, invites.json, loaded when
 * first touched and written only after `fn` returns.
 */
interface InviteStore {
  add(row: InviteRow): Promise<void>;
  /** Use it up, once: the row, or null if it was used, revoked, expired or never there. */
  claim(id: string, userId: string): Promise<InviteRow | null>;
  get(id: string): Promise<InviteRow | null>;
  ofTenant(tenant: string): Promise<InviteRow[]>;
  /** Revoke the still-pending ones among `ids`; returns those it revoked. */
  revoke(ids: string[], by: string, reason: string): Promise<InviteRow[]>;
}

function dbInviteStore(t: Db): InviteStore {
  return {
    add: (row) => insertInviteDb(row, t),
    claim: (id, userId) => claimInviteDb(id, userId, t),
    get: (id) => inviteByIdDb(id, t),
    ofTenant: (tenant) => invitesOfTenantDb(tenant, t),
    revoke: (ids, by, reason) => revokeInvitesDb(ids, by, reason, t),
  };
}

function fileInviteStore(): InviteStore & { flush(): void } {
  let rows: InviteRow[] | null = null;
  let dirty = false;
  const load = () => (rows ??= readInvitesFile());
  return {
    async add(row) {
      load().push({ ...row });
      dirty = true;
    },
    async claim(id, userId) {
      const r = load().find((x) => x.id === id);
      if (!r || inviteStatus(r) !== "pending") return null;
      r.usedAt = new Date().toISOString();
      r.usedBy = userId;
      dirty = true;
      return { ...r };
    },
    async get(id) {
      const r = load().find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async ofTenant(tenant) {
      return load()
        .filter((x) => x.tenant === tenant)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map((x) => ({ ...x }));
    },
    async revoke(ids, by, reason) {
      const at = new Date().toISOString();
      const out: InviteRow[] = [];
      for (const r of load()) {
        if (!ids.includes(r.id) || r.usedAt || r.revokedAt) continue;
        Object.assign(r, { revokedAt: at, revokedBy: by, revokeReason: reason });
        out.push({ ...r });
      }
      if (out.length) dirty = true;
      return out;
    },
    flush() {
      if (dirty && rows) writeInvitesFile(rows);
    },
  };
}

/**
 * Change people. `fn` gets everyone, read fresh under the lock, and may edit
 * records in place, push new ones, or splice one out — and the team's
 * invites, in the same transaction. Its throw rolls back both.
 * Keep `fn` quick and local: no network calls while the lock is held.
 */
async function mutateUsers<T>(fn: (users: UserRecord[], invites: InviteStore) => T | Promise<T>): Promise<T> {
  if (databaseEnabled()) {
    return tx(async (t) => {
      await t.execute(sql`select pg_advisory_xact_lock(${USERS_LOCK})`);
      const users = (await allUsersDb(t)) as UserRecord[];
      const before = new Map(users.map((u) => [u.id, JSON.stringify(u)]));
      const value = await fn(users, dbInviteStore(t));
      const after = new Set<string>();
      for (const u of users) {
        after.add(u.id);
        if (before.get(u.id) !== JSON.stringify(u)) await upsertUserDb(u, t);
      }
      for (const id of before.keys()) {
        if (!after.has(id)) await t.delete(usersTable).where(eq(usersTable.id, id));
      }
      return value;
    });
  }
  const run = fileQueue.then(async () => {
    const users = readUsersFile();
    const invites = fileInviteStore();
    const value = await fn(users, invites);
    // The invites first: a crash between the two writes then leaves an
    // invite used and no member — refused, never a link that works twice.
    invites.flush();
    fs.mkdirSync(path.dirname(usersFile()), { recursive: true });
    fs.writeFileSync(usersFile(), JSON.stringify(users, null, 2), { mode: 0o600 });
    return value;
  });
  fileQueue = run.catch(() => undefined);
  return run;
}

/** The file's people, into the database, once. Idempotent. */
export async function importUsersFromFile(): Promise<number> {
  if (!databaseEnabled()) return 0;
  return importUsersToDatabase(readUsersFile());
}

const scrypt = (password: string, salt: string) =>
  crypto.scryptSync(password, salt, 64).toString("hex");

export async function hasUsers(): Promise<boolean> {
  return (await readUsers()).length > 0;
}

export async function signupOpen(): Promise<boolean> {
  return !await hasUsers() || process.env.FOLDRUN_OPEN_SIGNUP === "1";
}

/**
 * Whether the first account needs the install's setup token. The first
 * person to sign up becomes the owner, and on a shared machine every local
 * user can reach `localhost`; FOLDRUN_SETUP_TOKEN (the self-hosting
 * installer writes it to .env and prints the signup link with it) ties that
 * first signup to whoever ran the installer. Unset — the hosted platform, a
 * one-person laptop — the first signup is free, as it always was. Once any
 * account exists the token does nothing.
 */
export async function setupTokenRequired(): Promise<boolean> {
  return Boolean(process.env.FOLDRUN_SETUP_TOKEN) && !await hasUsers();
}

/** The given token is the install's, compared in constant time. */
export function setupTokenMatches(given: unknown): boolean {
  const want = Buffer.from(process.env.FOLDRUN_SETUP_TOKEN ?? "");
  if (!want.length || typeof given !== "string") return false;
  // Bytes, not characters: equal string lengths can differ in UTF-8, and
  // timingSafeEqual throws on unequal lengths (a 500 instead of a refusal).
  const got = Buffer.from(given);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function findUser(email: string): Promise<UserRecord | null> {
  const needle = email.trim().toLowerCase();
  return (await readUsers()).find((u) => u.email === needle) ?? null;
}

/** What the users lock knows when it decides whether this person may be
 *  added: asked inside the lock, so two at once cannot both pass. */
export interface NewUserFacts {
  accountExists: boolean;
  emailTaken: boolean;
  nameTaken: boolean;
}

/**
 * Add a person, and — for an owner — their account: the address, password
 * and name checks, one locked write, the account's files and its own
 * encryption key. Every way in shares it; what differs is who may come in,
 * which `decide` answers (asked after the input checks, before anything
 * specific to this address; its answer is applied inside the lock).
 */
async function addUser(
  email: string,
  password: string,
  tenant: string,
  opts: { joining?: boolean; role?: Role; workspaces?: string[] | null },
  decide: () => Promise<(facts: NewUserFacts) => void>,
): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("that is not an email address");
  await assertPasswordPolicy(password, normalized);
  assertSafeName(tenant, "account name");
  const allowed = await decide();

  const salt = crypto.randomBytes(16).toString("hex");
  const user: UserRecord = {
    id: crypto.randomBytes(8).toString("hex"),
    email: normalized,
    tenant,
    salt,
    hash: scrypt(password, salt),
    createdAt: new Date().toISOString(),
    // The first member of an account owns it; anyone arriving on an invite
    // does not. `joining` is set exactly when this signup came through one,
    // and the invite says what they may do.
    owner: !opts.joining,
    ...(opts.joining ? { role: opts.role ?? "editor" } : {}),
    ...(opts.joining && opts.workspaces ? { workspaces: opts.workspaces } : {}),
  };
  await mutateUsers((users) => {
    allowed({
      accountExists: users.some((u) => u.tenant === tenant),
      emailTaken: users.some((u) => u.email === normalized),
      nameTaken: users.some((u) => u.tenant === tenant) || fs.existsSync(accountDir(tenant)),
    });
    users.push(user);
  });

  // The account exists the moment its owner does — same lazy scaffold every
  // other path goes through, just earlier, so the first dashboard render
  // has something to show.
  fs.mkdirSync(path.join(accountDir(tenant), "workspaces"), { recursive: true });
  ensureAccountFiles(tenant);
  // The account's own encryption key, minted the moment the account exists.
  // It used to be minted only at boot, so an account created after boot
  // kept its secrets under the install key until the next deploy. Idempotent
  // across replicas; a no-op without a database.
  await ensureTenantKey(tenant);
  return user;
}

/** A sign-up: the install's signup rules decide (core signup.ts). */
export async function createUser(
  email: string,
  password: string,
  tenant: string,
  opts: { joining?: boolean; role?: Role; workspaces?: string[] | null } = {},
): Promise<UserRecord> {
  return addUser(email, password, tenant, opts, async () => {
    // The order these are asked in is a security property, and it lives in
    // core where it can be unit-tested — see signup.ts. Briefly: whether signup
    // is possible at all is decided BEFORE anything specific to this address,
    // so a closed install refuses every address with the same sentence instead
    // of confirming which ones are registered.
    const open = await signupOpen();
    return (facts) => assertSignupAllowed({ joining: Boolean(opts.joining), open, ...facts });
  });
}

/**
 * A new account and its owner, made by trusted server code rather than a
 * sign-up form — the hosted operator console's way in for a customer who was
 * sold to (foldrun-admin). `allowed` is the caller's rule, asked inside the
 * lock; the signup gate is not asked, so nothing that answers a request
 * from the public may call this.
 */
export async function createAccountOwner(email: string, password: string, tenant: string, allowed: (facts: NewUserFacts) => void): Promise<UserRecord> {
  return addUser(email, password, tenant, {}, async () => allowed);
}

export async function verifyPassword(email: string, password: string): Promise<UserRecord | null> {
  const user = await findUser(email);
  if (!user) {
    // Burn the same time a real check would, so response timing does not
    // say which emails exist.
    scrypt(password, "0".repeat(32));
    return null;
  }
  const presented = Buffer.from(scrypt(password, user.salt), "hex");
  const stored = Buffer.from(user.hash, "hex");
  return presented.length === stored.length && crypto.timingSafeEqual(presented, stored)
    ? user
    : null;
}

/**
 * Change a password, proving you know the current one.
 *
 * Sessions are signed statements rather than rows, so an outstanding cookie
 * survives this — the same trade the module makes everywhere. Signing other
 * devices out means rotating the install key, which is a different button
 * with a much bigger blast radius.
 */
/** Does this password open this account? Constant-time, and says nothing
 *  about WHY not — the caller turns a false into one sentence. */
export async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const user = (await readUsers()).find((u) => u.id === userId);
  if (!user) return false;
  const presented = Buffer.from(scrypt(password, user.salt), "hex");
  const stored = Buffer.from(user.hash, "hex");
  return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const known = await findUserById(userId);
  if (!known) throw new Error("no such user");
  await assertPasswordPolicy(next, known.email);
  // A fresh salt with the new password: reusing the old one would let anyone
  // holding a stolen users.json tell that the password changed but the salt
  // did not, and rainbow work done against the old salt still applies.
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = scrypt(next, salt);
  await mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("no such user");
    const presented = Buffer.from(scrypt(current, user.salt), "hex");
    const stored = Buffer.from(user.hash, "hex");
    if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) {
      throw new Error("that is not your current password");
    }
    user.salt = salt;
    user.hash = hash;
  });
}

// ---------- sessions ----------

export const SESSION_COOKIE = "foldrun_session";
const SESSION_DAYS = 30;

const sign = sessionMac;

/**
 * A token the browser holds. Verifiable by anyone with the install key,
 * forgeable by no one without it — and, when this install has a database,
 * backed by a row so it can be ended before it expires.
 *
 * v2 when there is somewhere to record it, v1 otherwise. The signature is the
 * same in both; what differs is whether the payload names a revocable session
 * or the user directly.
 */
export async function mintSession(
  user: UserRecord,
  userAgent?: string | null,
  how: { audience?: string | null; mfa?: boolean } = {},
): Promise<{ value: string; expires: Date; sessionId: string | null }> {
  const expires = sessionExpiry();
  if (revocable()) {
    const id = newSessionId();
    await recordSession(id, user.id, user.tenant, expires, userAgent ?? null, how);
    const payload = `${id}.${expires.getTime()}`;
    return { value: `v2.${payload}.${sign(payload)}`, expires, sessionId: id };
  }
  const payload = `${user.id}.${expires.getTime()}`;
  return { value: `v1.${payload}.${sign(payload)}`, expires, sessionId: null };
}

/** The session id inside a token, without deciding whether it is still live.
 *  For "which of these rows is the one I am using". */
export function sessionIdOf(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  return parts.length === 4 && parts[0] === "v2" ? parts[1] : null;
}

/** Cookie attributes for the session, derived from how the request actually
 *  arrived. `secure` follows the wire, not NODE_ENV: a production build
 *  served over plain http (a LAN install, an internal box behind no TLS)
 *  set a Secure cookie the browser silently discarded — login returned 200
 *  and the dashboard bounced straight back to the sign-in page. */
export function sessionCookieOptions(req: { headers: Headers; url: string }, expires: Date) {
  const https =
    req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ||
    new URL(req.url).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: https,
    expires,
    path: "/",
  };
}

// ---------- teams ----------

// One account, many users: membership is `user.tenant`, and joining is an
// invite link. Until 29 Oct 2026 the link was the whole invite — a signed
// statement stored nowhere — so it could be used any number of times, by
// any number of people, for seven days, and nobody could take it back: a
// member removed from the team rejoined with the link they came in on.
//
// Now an invite is a row (platform/invites.ts) and the link names it:
// `inv4.<id>.<expiresMs>.<hmac>`. The MAC and expiry are checked before
// anything is read, so a guessed id costs nothing; the row says what it
// grants and to whom, and is used up in the same transaction that creates
// the member. Removing or demoting the member who made it, or removing the
// person it was for, revokes it; so does a newer invite to the same
// address, and Settings → Team. Older link forms (inv1–inv3) are refused.

const INVITE_DAYS = 7;
const INVITE_RE = /^inv4\.([0-9a-f]{32})\.(\d{1,15})\.([0-9a-f]{64})$/;
const inviteMac = (id: string, expires: string) => sign(`invite4:${id}.${expires}`);

/** The one sentence every dead link gets — used, revoked, expired, forged,
 *  from before 29 Oct, or its maker no longer able to make it: the holder
 *  is not told which. */
export const INVITE_INVALID = "That invite is no longer valid (used, revoked or expired) — ask for a fresh link";
const invalidInvite = () => Object.assign(new Error(INVITE_INVALID), { status: 400 });

export interface InviteOptions {
  /** Which workspaces the invitee may open; null or absent for all. */
  workspaces?: string[] | null;
  /** The address it is for: only that address can accept it, so a
   *  forwarded link is not a key. Absent: anyone with the link — once. */
  email?: string | null;
  /** Who is making it. Their standing is checked again when it is accepted.
   *  `role` and `workspaces` (theirs, null for all) bound which older invites
   *  to the same address this one may supersede: only those they could
   *  revoke themselves. Absent: the maker's own record decides. */
  by: { id: string; email: string; role?: Role; workspaces?: string[] | null };
}

/** The id and expiry a well-formed, correctly signed, unexpired link names;
 *  null for anything else. Reads nothing. */
function parseInviteToken(token: string | undefined): { id: string; expires: number } | null {
  const m = typeof token === "string" ? INVITE_RE.exec(token) : null;
  if (!m) return null;
  const [, id, expires, mac] = m;
  if (Number(expires) <= Date.now()) return null;
  const presented = Buffer.from(mac, "latin1");
  const wanted = Buffer.from(inviteMac(id, expires), "latin1");
  if (presented.length !== wanted.length || !crypto.timingSafeEqual(presented, wanted)) return null;
  return { id, expires: Number(expires) };
}

/** Could the member who made this invite still make it? Still in the
 *  account, still managing the team (and the admins, for an admin invite),
 *  and every workspace it opens still one they can open. */
function minterStillMay(users: UserRecord[], row: InviteRow): boolean {
  const role = roleOfMembers(users, row.tenant, row.createdBy);
  if (!role || !can(role, "team:manage")) return false;
  if (row.role === "admin" && !can(role, "admins:manage")) return false;
  const minter = users.find((u) => u.tenant === row.tenant && u.id === row.createdBy)!;
  const scope = ownerOfMembers(users, row.tenant)?.id === minter.id ? null : (minter.workspaces ?? null);
  return withinScope(row.workspaces, scope);
}

/** Does `inner` (null: every workspace) fit inside `outer`? */
function withinScope(inner: string[] | null, outer: string[] | null): boolean {
  if (outer === null) return true;
  return inner !== null && inner.every((w) => outer.includes(w));
}

/**
 * Make an invite: a row, and the link that names it. A newer invite to an
 * address replaces any still pending to it in the same account — those are
 * revoked here, and their ids returned for the audit.
 */
export async function mintInvite(
  tenant: string,
  role: Role,
  opts: InviteOptions,
): Promise<{ id: string; token: string; expires: Date; superseded: string[] }> {
  if (!isRole(role) || role === "owner") throw new Error("an invite can be viewer, editor or admin");
  const id = crypto.randomBytes(16).toString("hex");
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const email = opts.email ? opts.email.trim().toLowerCase() : null;
  const workspaces = opts.workspaces ? [...new Set(opts.workspaces)] : null;
  const superseded = await mutateUsers(async (users, invites) => {
    let gone: InviteRow[] = [];
    if (email) {
      // Only the ones this maker could revoke by hand (DELETE
      // /api/team/invites/<id>): inside their scope, and an admin invite
      // only by the owner. Anything else stays pending beside the new one.
      const makerRole = opts.by.role ?? roleOfMembers(users, tenant, opts.by.id);
      const maker = users.find((u) => u.tenant === tenant && u.id === opts.by.id);
      const makerScope = opts.by.workspaces !== undefined
        ? opts.by.workspaces
        : !maker || ownerOfMembers(users, tenant)?.id === maker.id ? null : (maker.workspaces ?? null);
      const mayRevoke = (r: InviteRow) =>
        makerRole !== null && withinScope(r.workspaces, makerScope) && (r.role !== "admin" || can(makerRole, "admins:manage"));
      const older = (await invites.ofTenant(tenant)).filter((r) => r.email === email && inviteStatus(r) === "pending" && mayRevoke(r));
      gone = await invites.revoke(older.map((r) => r.id), opts.by.email, "superseded by a newer invite to the same address");
    }
    await invites.add({
      id,
      tenant,
      role,
      workspaces,
      email,
      createdBy: opts.by.id,
      createdByEmail: opts.by.email,
      createdAt: new Date().toISOString(),
      expiresAt: expires.toISOString(),
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    });
    return gone.map((r) => r.id);
  });
  const ms = String(expires.getTime());
  return { id, token: `inv4.${id}.${ms}.${inviteMac(id, ms)}`, expires, superseded };
}

/** What a still-good link would grant, for the signup page — nothing is
 *  used up. Null when it would be refused. */
export interface InvitePreview {
  tenant: string;
  role: Role;
  workspaces: string[] | null;
  email: string | null;
}

export async function peekInvite(token: string | undefined): Promise<InvitePreview | null> {
  const parsed = parseInviteToken(token);
  if (!parsed) return null;
  const row = databaseEnabled() ? await inviteByIdDb(parsed.id) : readInvitesFile().find((r) => r.id === parsed.id) ?? null;
  if (!row || inviteStatus(row) !== "pending" || !isRole(row.role) || row.role === "owner") return null;
  if (!minterStillMay(await readUsers(), row)) return null;
  return { tenant: row.tenant, role: row.role, workspaces: row.workspaces, email: row.email };
}

/**
 * Join an account on an invite. The link's MAC and expiry, the address and
 * the password are checked first, outside the lock; then, in one
 * transaction: the invite is used up, the address checked against the one
 * it was for, its maker's standing checked again, and the member created
 * with the role and workspaces the ROW holds. Any refusal in there rolls
 * the whole of it back — the invite stays pending for the right person.
 */
export async function acceptInvite(
  token: string,
  email: string,
  password: string,
): Promise<{ user: UserRecord; invite: InviteRow }> {
  const parsed = parseInviteToken(token);
  if (!parsed) throw invalidInvite();
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("that is not an email address");
  await assertPasswordPolicy(password, normalized);
  const open = await signupOpen();

  const salt = crypto.randomBytes(16).toString("hex");
  const user: UserRecord = {
    id: crypto.randomBytes(8).toString("hex"),
    email: normalized,
    tenant: "",
    salt,
    hash: scrypt(password, salt),
    createdAt: new Date().toISOString(),
    owner: false,
  };
  const invite = await mutateUsers(async (users, invites) => {
    const row = await invites.claim(parsed.id, user.id);
    if (!row || !isRole(row.role) || row.role === "owner") throw invalidInvite();
    if (row.email && row.email !== normalized) {
      throw Object.assign(new Error(`this invite was sent to ${row.email} — sign up with that address`), { status: 400 });
    }
    if (!minterStillMay(users, row)) throw invalidInvite();
    assertSignupAllowed({
      joining: true,
      open,
      accountExists: users.some((u) => u.tenant === row.tenant),
      emailTaken: users.some((u) => u.email === normalized),
      nameTaken: true,
    });
    user.tenant = row.tenant;
    user.role = row.role;
    if (row.workspaces) user.workspaces = row.workspaces;
    users.push(user);
    return row;
  });

  fs.mkdirSync(path.join(accountDir(user.tenant), "workspaces"), { recursive: true });
  ensureAccountFiles(user.tenant);
  await ensureTenantKey(user.tenant);
  return { user, invite };
}

/** An invite as the team page and GET /api/team/invites show it — never
 *  the link, which exists only in the answer that minted it. */
export interface InviteView {
  id: string;
  email: string | null;
  role: Role;
  workspaces: string[] | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  status: InviteStatus;
}

const viewOf = (r: InviteRow): InviteView => ({
  id: r.id,
  email: r.email,
  role: r.role as Role,
  workspaces: r.workspaces,
  invitedBy: r.createdByEmail,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  status: inviteStatus(r),
});

async function invitesOf(tenant: string): Promise<InviteRow[]> {
  if (databaseEnabled()) return invitesOfTenantDb(tenant);
  return readInvitesFile()
    .filter((r) => r.tenant === tenant)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/**
 * An account's invites, newest first: the pending ones, or every one with
 * `all`. A caller scoped to some workspaces sees only invites inside its
 * own scope — not one for every workspace, nor one naming a workspace it
 * was not given.
 */
export async function listInvites(tenant: string, opts: { all?: boolean; scope: string[] | null }): Promise<InviteView[]> {
  return (await invitesOf(tenant))
    .filter((r) => withinScope(r.workspaces, opts.scope))
    .map(viewOf)
    .filter((v) => opts.all || v.status === "pending");
}

/** One invite of this account, or null — for a route's scope check. */
export async function findInvite(tenant: string, id: string): Promise<InviteView | null> {
  const row = databaseEnabled() ? await inviteByIdDb(id) : readInvitesFile().find((r) => r.id === id) ?? null;
  return row && row.tenant === tenant ? viewOf(row) : null;
}

/**
 * Revoke one invite. 404 for one that is not this account's, 409 for one
 * already accepted (remove the member instead); one already revoked or
 * expired answers as revoked, `changed: false`.
 */
export async function revokeInvite(tenant: string, id: string, by: string): Promise<{ invite: InviteView; changed: boolean }> {
  return mutateUsers(async (_users, invites) => {
    const row = await invites.get(id);
    if (!row || row.tenant !== tenant) throw Object.assign(new Error("no such invite"), { status: 404 });
    if (row.usedAt) throw Object.assign(new Error("that invite was already accepted — remove the member instead"), { status: 409 });
    // Already over — revoked, or expired: left as it was, so its history
    // still says which.
    if (inviteStatus(row) !== "pending") return { invite: viewOf(row), changed: false };
    const [done] = await invites.revoke([row.id], by, "revoked");
    return { invite: viewOf(done ?? row), changed: Boolean(done) };
  });
}

/**
 * Revoke the pending invites a member made that they could no longer make
 * (`now` their new standing; null when they left), and — on removal — the
 * pending ones addressed to them. Mirrors revokeKeysBeyond: an invite is no
 * more a way to keep access than a key is. Returns the ids revoked.
 */
export async function revokeInvitesBeyond(
  tenant: string,
  member: { id: string; email: string },
  now: { role: Role; workspaces: string[] | null } | null,
  by: string,
): Promise<string[]> {
  const email = member.email.toLowerCase();
  const beyond = (r: InviteRow) => {
    if (r.createdBy !== member.id) return false;
    if (!now) return true;
    if (!can(now.role, "team:manage")) return true;
    if (r.role === "admin" && !can(now.role, "admins:manage")) return true;
    return !withinScope(r.workspaces, now.workspaces);
  };
  return mutateUsers(async (_users, invites) => {
    const pending = (await invites.ofTenant(tenant)).filter((r) => inviteStatus(r) === "pending");
    const ids = pending.filter((r) => beyond(r) || (!now && r.email === email)).map((r) => r.id);
    const reason = now ? "its maker's role or workspaces narrowed" : "its maker or addressee left the team";
    return (await invites.revoke(ids, by, reason)).map((r) => r.id);
  });
}

export async function listMembers(tenant: string): Promise<{ id: string; email: string; createdAt: string; owner: boolean; role: Role; workspaces: string[] | null }[]> {
  // The owner is marked, so the team list can say who holds the account and
  // hide a Remove button that would only 403. The role is the effective one —
  // derived for the owner, defaulted for members older than roles.
  const users = await readUsers();
  const ownerId = ownerOfMembers(users, tenant)?.id;
  return users
    .filter((u) => u.tenant === tenant)
    .map(({ id, email, createdAt, workspaces }) => ({
      id,
      email,
      createdAt,
      owner: id === ownerId,
      role: roleOfMembers(users, tenant, id) ?? "viewer",
      workspaces: id === ownerId ? null : (workspaces ?? null),
    }));
}

/** The workspaces a member may open: null for all. The owner sees all. */
/**
 * The signed-in viewer's workspace scope, from the request's cookie — null
 * for "all of them" (an unscoped member, or no session in dev). Every
 * ACCOUNT-level page that lists across workspaces filters through this;
 * the workspace-level tree is gated once in its layout and needs nothing.
 *
 * One call, because the pattern it replaces was three lines copied into
 * each page — and two pages (storage, graph) never got the copy, so a
 * scoped member saw every workspace's files there for four days.
 */
/** The signed-in viewer's role, for a page that shows something only some
 *  roles may see (a signing secret, a webhook URL). Null when nobody is
 *  signed in — dev mode — which every caller treats as the owner. */
export async function viewerRole(): Promise<Role | null> {
  const { cookies } = await import("next/headers");
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return session ? roleOfMembers(await readUsers(), session.tenant, session.id) : null;
}

/** The signed-in viewer's email, lower-cased — whose inbox a page shows.
 *  Null when nobody is signed in (dev mode). */
export async function viewerEmail(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return session?.email ? session.email.toLowerCase() : null;
}

export async function viewerScope(): Promise<string[] | null> {
  const { cookies } = await import("next/headers");
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return session ? allowedWorkspaces(session.tenant, session.id) : null;
}

export async function allowedWorkspaces(tenant: string, userId: string): Promise<string[] | null> {
  const users = await readUsers();
  const u = users.find((x) => x.tenant === tenant && x.id === userId);
  if (!u) return [];
  if (ownerOfMembers(users, tenant)?.id === userId) return null;
  return u.workspaces ?? null;
}

/** Set which workspaces a member may open. Null opens all. The owner is
 *  never scoped, and only someone who manages the team may do this. */
export async function setMemberScope(tenant: string, id: string, workspaces: string[] | null, actorId: string): Promise<void> {
  return mutateUsers((users) => {
  const target = users.find((u) => u.tenant === tenant && u.id === id);
  if (!target) throw Object.assign(new Error("no such member"), { status: 404 });
  if (ownerOfMembers(users, tenant)?.id === id) throw Object.assign(new Error("the owner sees every workspace"), { status: 400 });
  const actorRole = roleOfMembers(users, tenant, actorId);
  if (!actorRole || !can(actorRole, "team:manage")) throw Object.assign(new Error("your role cannot change who sees what"), { status: 403 });
  if (id !== actorId && actorRole !== "owner") {
    // Strictly above them: an admin narrowing another admin to no
    // workspaces would lock them out, and only the owner makes or unmakes
    // an admin.
    const targetRole = roleOfMembers(users, tenant, id) ?? "viewer";
    if (!outranks(actorRole, targetRole)) throw Object.assign(new Error(targetRole === actorRole ? "only the owner can change what another " + targetRole + " sees" : "that member outranks you"), { status: 403 });
  }
  if (workspaces) {
    for (const w of workspaces) assertSafeName(w, "workspace");
  }
  target.workspaces = workspaces && workspaces.length ? [...new Set(workspaces)] : workspaces === null ? null : [];
  });
}


/** A member's effective role, or null for a non-member. */
export async function roleOfUser(tenant: string, userId: string): Promise<Role | null> {
  return roleOfMembers(await readUsers(), tenant, userId);
}

/** Give a member a role, as somebody. The rules are in permissions.ts. */
export async function setMemberRole(tenant: string, id: string, role: Role, actorId: string): Promise<void> {
  return mutateUsers((users) => {
    assertCanChangeRole(users, tenant, id, role, actorId); // throws with a status
    const target = users.find((u) => u.tenant === tenant && u.id === id)!;
    target.role = role;
  });
}

/**
 * Hand the account to another member. The old owner becomes an admin: they
 * keep running the account, they just stop being the one who pays for it.
 */
export async function transferOwnership(tenant: string, toId: string, actorId: string): Promise<void> {
  return mutateUsers((users) => {
  assertCanTransfer(users, tenant, toId, actorId); // throws with a status
  for (const u of users) {
    if (u.tenant !== tenant) continue;
    if (u.id === toId) {
      u.owner = true;
      delete u.role;
    } else if (u.owner || u.id === actorId) {
      u.owner = false;
      u.role = "admin";
    }
  }
  });
}

/**
 * Who owns this account — the rule lives in core/src/ownership.ts, which is
 * where it can be unit-tested. This is the store half.
 */
export async function ownerOf(tenant: string): Promise<UserRecord | null> {
  return ownerOfMembers(await readUsers(), tenant);
}

export async function isOwner(tenant: string, userId: string): Promise<boolean> {
  return isOwnerOf(await readUsers(), tenant, userId);
}

/**
 * Remove a member, as somebody.
 *
 * `actorId` is required rather than optional. An optional actor is a check a
 * future caller forgets to pass and silently skips, which is the shape of the
 * bug this is fixing.
 */
export async function removeMember(tenant: string, id: string, actorId: string, by: string = actorId): Promise<false | { invitesRevoked: string[] }> {
  return mutateUsers(async (users, invites) => {
    const at = users.findIndex((u) => u.tenant === tenant && u.id === id);
    if (at < 0) return false;
    assertCanRemoveMember(users, tenant, id, actorId); // throws with a status
    const [gone] = users.splice(at, 1);
    // In the same transaction: every pending invite they made, and every
    // one still pending to their address. Done after, a removed person
    // could accept one addressed to them in between and be back.
    const email = gone.email.toLowerCase();
    const ids = (await invites.ofTenant(tenant))
      .filter((r) => inviteStatus(r) === "pending" && (r.createdBy === id || r.email === email))
      .map((r) => r.id);
    const revoked = await invites.revoke(ids, by, "its maker or addressee left the team");
    return { invitesRevoked: revoked.map((r) => r.id) };
  });
}

/**
 * Is this a timezone this runtime actually knows?
 *
 * Checked by asking Intl to use it rather than against a hardcoded list: the
 * IANA database gains and renames zones, and a list in here would be wrong
 * within a year. An unknown zone must be refused rather than stored, because
 * every later format call would throw on a value we accepted.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Set (or clear) the zone this person reads times in. Null restores
 * automatic — the browser's own answer — which is the default and the case
 * that needs no stored value at all.
 */
/**
 * A new password with no old one presented — the super admin's lever, and the
 * end of a forgot-password flow. Everything changePassword does except the
 * check it cannot make. A fresh salt, and every session of theirs is ended:
 * a reset that leaves a stolen session alive is not a reset.
 */
export async function resetPassword(userId: string, next: string): Promise<void> {
  const known = await findUserById(userId);
  if (!known) throw new Error("no such user");
  await assertPasswordPolicy(next, known.email);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = scrypt(next, salt);
  await mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("no such user");
    user.salt = salt;
    user.hash = hash;
  });
  await revokeSessions(userId);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return (await readUsers()).find((u) => u.id === id) ?? null;
}

/**
 * Move a person to a new address.
 *
 * The address is a login, a recovery channel and — for an account's owner —
 * the identity everything else hangs off, so this does three things at
 * once and refuses to do any of them halfway: it checks the new address is
 * free (addresses are unique across the whole install, not per account),
 * writes it, and clears verification, because the new inbox is unproven
 * however well the old one was known. Whoever called this sends the
 * confirmation mail; this only records the change.
 *
 * Returns the old address, which the caller puts on the audit line — an
 * email change with no record of what it changed FROM is the one edit a
 * hijacked account most wants to leave behind.
 */
/** Set (or clear) how a person is addressed. Trimmed, capped, and never a
 *  requirement — an empty half is stored as null, and display falls back
 *  to the email. */
export async function setName(userId: string, firstName: string | null, lastName: string | null): Promise<void> {
  const clean = (v: string | null) => {
    const t = (v ?? "").trim().slice(0, 80);
    return t.length ? t : null;
  };
  await mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw Object.assign(new Error("no such user"), { status: 404 });
    user.firstName = clean(firstName);
    user.lastName = clean(lastName);
  });
}

/** The name to show for a person: what they told us, or their email. */
export function displayName(u: Pick<UserRecord, "email" | "firstName" | "lastName">): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full || u.email;
}

export async function changeEmail(userId: string, newEmail: string): Promise<{ from: string; to: string }> {
  const to = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw Object.assign(new Error("that is not an email address"), { status: 400 });
  const { from, tenant } = await mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw Object.assign(new Error("no such user"), { status: 404 });
    if (user.email === to) throw Object.assign(new Error("that is already their address"), { status: 409 });
    if (users.some((u) => u.email === to)) throw Object.assign(new Error("that address already belongs to someone"), { status: 409 });
    const was = user.email;
    user.email = to;
    user.emailVerifiedAt = null;
    return { from: was, tenant: user.tenant };
  });
  // Their API keys name them by address: they move too (FOL-97). Imported
  // here, not at the top — auth.ts imports this file.
  await (await import("./auth.ts")).moveKeysToEmail(tenant, from, to);
  return { from, to };
}

export async function setEmailVerified(userId: string): Promise<void> {
  return mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("no such user");
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date().toISOString();
  });
}

/** Turn the second factor on (sealed secret + hashed backup codes) or off (null). */
export async function setMfa(userId: string, mfa: { secret: string; backupHashes: string[] } | null): Promise<void> {
  return mutateUsers((users) => {
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  if (mfa) {
    user.mfaSecret = sealString(mfa.secret, mfaBinding(user.id));
    user.mfaBackup = mfa.backupHashes;
    user.mfaEnabledAt = new Date().toISOString();
  } else {
    delete user.mfaSecret; delete user.mfaBackup; delete user.mfaEnabledAt;
  }
  });
}

/** A second factor still sealed the old, unbound way: seal it bound to its
 *  person, in place (lazily, at a sign-in that proved it). A no-op until the
 *  install writes bound records, or when it already is. */
export async function rebindMfa(userId: string): Promise<boolean> {
  if (process.env.FOLDRUN_VAULT_WRITE_BOUND !== "1") return false;
  return mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user?.mfaSecret || !isUnboundSeal(user.mfaSecret)) return false;
    user.mfaSecret = sealString(openString(user.mfaSecret), mfaBinding(user.id));
    return true;
  });
}

/** A backup code was used: strike it. Returns false if it was not one of theirs. */
export async function consumeBackupCode(userId: string, hash: string): Promise<boolean> {
  // Under the lock, so two requests racing with the same code get one true.
  return mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user?.mfaBackup?.includes(hash)) return false;
    user.mfaBackup = user.mfaBackup.filter((h) => h !== hash);
    return true;
  });
}

export async function setUserTimezone(userId: string, tz: string | null): Promise<void> {
  if (tz !== null && !isValidTimeZone(tz)) throw new Error(`not a known timezone: ${tz}`);
  return mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("no such user");
    if (tz === null) delete user.timezone;
    else user.timezone = tz;
  });
}

/** A person's own small settings, merged: `null` clears a key. */
export async function setUserPrefs(userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return mutateUsers((users) => {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("no such user");
    const prefs: Record<string, unknown> = { ...(user.prefs ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete prefs[k];
      else prefs[k] = v;
    }
    user.prefs = Object.keys(prefs).length ? prefs : null;
    return prefs;
  });
}

/**
 * Who this token belongs to, if it is still allowed.
 *
 * Two checks, and both matter: the signature stops a fabricated token without
 * touching the database, and — for v2 — the row stops a GENUINE token
 * outliving the moment its owner ended it. Async because the second one is a
 * query, and a revocation checked on only some paths is not a revocation.
 */
export async function verifySession(token: string | undefined): Promise<UserRecord | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, subject, expires, mac] = parts;
  if (version !== "v1" && version !== "v2" && version !== "s1") return null;
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return null;

  const expected = sign(`${subject}.${expires}`);
  const presented = Buffer.from(mac, "latin1");
  const wanted = Buffer.from(expected, "latin1");
  if (presented.length !== wanted.length || !crypto.timingSafeEqual(presented, wanted)) return null;

  if (version === "s1") {
    // A support view (the hosted console's: foldrun-admin view-as.ts mints
    // them): live only while its grant is — ended or lapsed, the token is
    // nothing. It reads as the account's owner, marked read-only. As this
    // repository has it no grant is ever live (server/view-as.ts is a stub).
    const [tenant, id] = Buffer.from(subject, "base64url").toString().split(":");
    if (!tenant || !id) return null;
    const { liveSupportView } = await import("./view-as.ts");
    const view = await liveSupportView(tenant, id);
    if (!view) return null;
    const owner = await ownerOf(tenant);
    if (!owner) return null;
    return { ...owner, viewAs: { id: view.id, by: view.by, reason: view.reason, expiresAt: view.expiresAt }, session: { kind: "s1", audience: null, mfa: false } };
  }
  if (version === "v2") {
    // The signature proves nobody forged the id. The row decides whether it is
    // still live — and refuses if there is no database to ask, because a token
    // that claims to be revocable and is checked against nothing is worse than
    // one that never claimed it.
    const live = await sessionAllowed(subject);
    if (!live) return null;
    const user = (await readUsers()).find((u) => u.id === live.userId);
    return user ? { ...user, session: { kind: "v2", audience: live.audience, mfa: live.mfa } } : null;
  }
  // v1: the pre-database form, minted only where an install has no database.
  // Where there is one, a v1 token cannot be revoked by sign-out, a reset or
  // Settings → Sessions, and carries no MFA fact — refused (29 Oct 2026; v2
  // has been minted there for well over the 30-day life of any v1).
  if (databaseEnabled()) return null;
  const user = (await readUsers()).find((u) => u.id === subject);
  return user ? { ...user, session: { kind: "v1", audience: null, mfa: false } } : null;
}
