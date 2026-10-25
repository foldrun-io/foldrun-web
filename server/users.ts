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
import { tx, databaseEnabled, users as usersTable, notInArray } from "@/platform/orm";
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
import { formatScope, parseScope } from "@/platform/scope.ts";

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
  /** Set only on a support view's session (never stored): the super admin
   *  reading this account as its owner sees it, read-only, until expiresAt.
   *  Every write is refused while it is set — proxy.ts and server/api.ts. */
  viewAs?: { id: string; by: string; reason: string; expiresAt: string } | null;
  /** A person's own small settings: `onboardingDismissedAt`, and the like. */
  prefs?: Record<string, unknown> | null;
}

// A string sealed under the install key: AES-256-GCM, iv.tag.ciphertext,
// tag length pinned. For the one secret a user row holds that must not be
// readable from a dump of the table — the second factor.
const GCM = { authTagLength: 16 } as const;
const installKeyBytes = () => crypto.createHash("sha256").update(installKey()).digest();
export function sealString(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", installKeyBytes(), iv, GCM);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}
export function openString(sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", installKeyBytes(), raw.subarray(0, 12), GCM);
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

// The store: rows when this install has a database, the file when it does
// not. The array shape is kept on purpose — every mutation below reads the
// people, changes one or two, and writes them back, and that code is the
// part with the security rules in it (who may remove whom, who may hand the
// account over). Changing the storage without touching those rules is the
// whole point of the seam. In database mode a write-back is one transaction:
// upsert what is here, delete what is not. Small N; per-row writes are the
// optimisation for a day this list is long.

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

async function writeUsers(users: UserRecord[]): Promise<void> {
  if (databaseEnabled()) {
    await tx(async (t) => {
      for (const u of users) await upsertUserDb(u, t);
      const keep = users.map((u) => u.id);
      // Whoever is not in the array any more has left.
      if (keep.length) await t.delete(usersTable).where(notInArray(usersTable.id, keep));
      else await t.delete(usersTable);
    });
    return;
  }
  fs.mkdirSync(path.dirname(usersFile()), { recursive: true });
  fs.writeFileSync(usersFile(), JSON.stringify(users, null, 2), { mode: 0o600 });
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

export async function findUser(email: string): Promise<UserRecord | null> {
  const needle = email.trim().toLowerCase();
  return (await readUsers()).find((u) => u.email === needle) ?? null;
}

export async function createUser(
  email: string,
  password: string,
  tenant: string,
  opts: { joining?: boolean; role?: Role; workspaces?: string[] | null } = {},
): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("that is not an email address");
  await assertPasswordPolicy(password, normalized);
  assertSafeName(tenant, "account name");

  // The order these are asked in is a security property, and it lives in
  // core where it can be unit-tested — see signup.ts. Briefly: whether signup
  // is possible at all is decided BEFORE anything specific to this address,
  // so a closed install refuses every address with the same sentence instead
  // of confirming which ones are registered.
  const users = await readUsers();
  assertSignupAllowed({
    joining: Boolean(opts.joining),
    open: await signupOpen(),
    accountExists: users.some((u) => u.tenant === tenant),
    emailTaken: Boolean(await findUser(normalized)),
    nameTaken: users.some((u) => u.tenant === tenant) || fs.existsSync(accountDir(tenant)),
  });

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
  await writeUsers([...await readUsers(), user]);

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
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  await assertPasswordPolicy(next, user.email);
  const presented = Buffer.from(scrypt(current, user.salt), "hex");
  const stored = Buffer.from(user.hash, "hex");
  if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) {
    throw new Error("that is not your current password");
  }
  // A fresh salt with the new password: reusing the old one would let anyone
  // holding a stolen users.json tell that the password changed but the salt
  // did not, and rainbow work done against the old salt still applies.
  user.salt = crypto.randomBytes(16).toString("hex");
  user.hash = scrypt(next, user.salt);
  await writeUsers(users);
}

// ---------- sessions ----------

export const SESSION_COOKIE = "foldrun_session";
const SESSION_DAYS = 30;

const sign = (payload: string) =>
  crypto.createHmac("sha256", installKey()).update(payload).digest("hex");

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
): Promise<{ value: string; expires: Date; sessionId: string | null }> {
  const expires = sessionExpiry();
  if (revocable()) {
    const id = newSessionId();
    await recordSession(id, user.id, user.tenant, expires, userAgent ?? null);
    const payload = `${id}.${expires.getTime()}`;
    return { value: `v2.${payload}.${sign(payload)}`, expires, sessionId: id };
  }
  const payload = `${user.id}.${expires.getTime()}`;
  return { value: `v1.${payload}.${sign(payload)}`, expires, sessionId: null };
}

/**
 * A support view's token: the grant (account and id), its end, signed like a
 * session. It names no person — verifySession resolves it to the account's
 * owner, marked `viewAs`, for as long as the grant stays live.
 */
export function mintSupportSession(view: { tenant: string; id: string; expiresAt: string }): { value: string; expires: Date } {
  const expires = new Date(view.expiresAt);
  const subject = Buffer.from(`${view.tenant}:${view.id}`).toString("base64url");
  const payload = `${subject}.${expires.getTime()}`;
  return { value: `s1.${payload}.${sign(payload)}`, expires };
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
// invite link — a signed statement like a session, stored nowhere, so an
// invite cannot be enumerated out of a table that does not exist. Rotating
// the install key voids outstanding invites along with everything else.

const INVITE_DAYS = 7;

/**
 * An invite carries the role it grants, signed with the rest, so the person
 * who accepts it cannot pick a better one. inv2; the inv1 form from before
 * roles is still honoured for the week it stays valid, as an admin — which is
 * what an invite meant when it was minted.
 */
export interface InviteOptions {
  /** Which workspaces the invitee may open; null or absent for all. */
  workspaces?: string[] | null;
  /** The address the invite was sent to. Bound into the token: only that
   *  address can accept it, so a forwarded link is not a key. */
  email?: string | null;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/**
 * An invite carries the role it grants, the workspaces it opens and the
 * address it went to, all signed together, so the person who accepts it
 * cannot pick a better one. inv3; the inv2 and inv1 forms from before are
 * still honoured for the week they stay valid, as "all workspaces".
 */
export function mintInvite(tenant: string, role: Role = "editor", opts: InviteOptions = {}): { token: string; expires: Date } {
  if (!isRole(role) || role === "owner") throw new Error("an invite can be viewer, editor or admin");
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const scope = formatScope(opts.workspaces ?? null);
  const email = opts.email ? b64(opts.email.trim().toLowerCase()) : "-";
  const payload = `${tenant}.${role}.${scope}.${email}.${expires.getTime()}`;
  return { token: `inv3.${payload}.${sign(`invite:${payload}`)}`, expires };
}

export interface Invite {
  tenant: string;
  role: Role;
  workspaces: string[] | null;
  email: string | null;
}

export function verifyInvite(token: string | undefined): Invite | null {
  if (!token) return null;
  const parts = token.split(".");
  let tenant: string;
  let role: Role;
  let expires: string;
  let mac: string;
  let payload: string;
  let workspaces: string[] | null = null;
  let email: string | null = null;
  if (parts.length === 7 && parts[0] === "inv3") {
    const claimed = parts[2];
    if (!isRole(claimed) || claimed === "owner") return null;
    [tenant, role, expires, mac] = [parts[1], claimed, parts[5], parts[6]];
    workspaces = parseScope(parts[3]);
    email = parts[4] === "-" ? null : unb64(parts[4]);
    payload = `${tenant}.${role}.${parts[3]}.${parts[4]}.${expires}`;
  } else if (parts.length === 5 && parts[0] === "inv2") {
    const claimed = parts[2];
    if (!isRole(claimed) || claimed === "owner") return null;
    [tenant, role, expires, mac] = [parts[1], claimed, parts[3], parts[4]];
    payload = `${tenant}.${role}.${expires}`;
  } else if (parts.length === 4 && parts[0] === "inv1") {
    [tenant, role, expires, mac] = [parts[1], "admin", parts[2], parts[3]];
    payload = `${tenant}.${expires}`;
  } else {
    return null;
  }
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return null;
  const expected = sign(`invite:${payload}`);
  const presented = Buffer.from(mac, "latin1");
  const wanted = Buffer.from(expected, "latin1");
  if (presented.length !== wanted.length || !crypto.timingSafeEqual(presented, wanted)) return null;
  return { tenant, role, workspaces, email };
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
  const users = await readUsers();
  const target = users.find((u) => u.tenant === tenant && u.id === id);
  if (!target) throw Object.assign(new Error("no such member"), { status: 404 });
  if (ownerOfMembers(users, tenant)?.id === id) throw Object.assign(new Error("the owner sees every workspace"), { status: 400 });
  const actorRole = roleOfMembers(users, tenant, actorId);
  if (!actorRole || !can(actorRole, "team:manage")) throw Object.assign(new Error("your role cannot change who sees what"), { status: 403 });
  if (id !== actorId && actorRole !== "owner") {
    const targetRole = roleOfMembers(users, tenant, id) ?? "viewer";
    if (!outranks(actorRole, targetRole) && actorRole !== targetRole) throw Object.assign(new Error("that member outranks you"), { status: 403 });
  }
  if (workspaces) {
    for (const w of workspaces) assertSafeName(w, "workspace");
  }
  await writeUsers(users.map((u) => (u === target ? { ...u, workspaces: workspaces && workspaces.length ? [...new Set(workspaces)] : workspaces === null ? null : [] } : u)));
}


/** A member's effective role, or null for a non-member. */
export async function roleOfUser(tenant: string, userId: string): Promise<Role | null> {
  return roleOfMembers(await readUsers(), tenant, userId);
}

/** Give a member a role, as somebody. The rules are in permissions.ts. */
export async function setMemberRole(tenant: string, id: string, role: Role, actorId: string): Promise<void> {
  const users = await readUsers();
  assertCanChangeRole(users, tenant, id, role, actorId); // throws with a status
  const target = users.find((u) => u.tenant === tenant && u.id === id)!;
  target.role = role;
  await writeUsers(users);
}

/**
 * Hand the account to another member. The old owner becomes an admin: they
 * keep running the account, they just stop being the one who pays for it.
 */
export async function transferOwnership(tenant: string, toId: string, actorId: string): Promise<void> {
  const users = await readUsers();
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
  await writeUsers(users);
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
export async function removeMember(tenant: string, id: string, actorId: string): Promise<boolean> {
  const users = await readUsers();
  const target = users.find((u) => u.tenant === tenant && u.id === id);
  if (!target) return false;
  assertCanRemoveMember(users, tenant, id, actorId); // throws with a status
  await writeUsers(users.filter((u) => u.id !== id));
  return true;
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
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  await assertPasswordPolicy(next, user.email);
  user.salt = crypto.randomBytes(16).toString("hex");
  user.hash = scrypt(next, user.salt);
  await writeUsers(users);
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
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw Object.assign(new Error("no such user"), { status: 404 });
  user.firstName = clean(firstName);
  user.lastName = clean(lastName);
  await writeUsers(users);
}

/** The name to show for a person: what they told us, or their email. */
export function displayName(u: Pick<UserRecord, "email" | "firstName" | "lastName">): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full || u.email;
}

export async function changeEmail(userId: string, newEmail: string): Promise<{ from: string; to: string }> {
  const to = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw Object.assign(new Error("that is not an email address"), { status: 400 });
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw Object.assign(new Error("no such user"), { status: 404 });
  if (user.email === to) throw Object.assign(new Error("that is already their address"), { status: 409 });
  if (users.some((u) => u.email === to)) throw Object.assign(new Error("that address already belongs to someone"), { status: 409 });
  const from = user.email;
  user.email = to;
  user.emailVerifiedAt = null;
  await writeUsers(users);
  return { from, to };
}

export async function setEmailVerified(userId: string): Promise<void> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date().toISOString();
    await writeUsers(users);
  }
}

/** Turn the second factor on (sealed secret + hashed backup codes) or off (null). */
export async function setMfa(userId: string, mfa: { secret: string; backupHashes: string[] } | null): Promise<void> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  if (mfa) {
    user.mfaSecret = sealString(mfa.secret);
    user.mfaBackup = mfa.backupHashes;
    user.mfaEnabledAt = new Date().toISOString();
  } else {
    delete user.mfaSecret; delete user.mfaBackup; delete user.mfaEnabledAt;
  }
  await writeUsers(users);
}

/** A backup code was used: strike it. Returns false if it was not one of theirs. */
export async function consumeBackupCode(userId: string, hash: string): Promise<boolean> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user?.mfaBackup?.includes(hash)) return false;
  user.mfaBackup = user.mfaBackup.filter((h) => h !== hash);
  await writeUsers(users);
  return true;
}

/**
 * A new account made by the super admin, not by a sign-up: the invite-only
 * install's front door for a customer who was sold to rather than one who
 * found the form. Everything createUser checks except "is signup open" —
 * the super admin IS the opening. The password is the caller's problem to hand
 * over; the reset link is the better handover.
 */
export async function createAccountBySuperAdmin(email: string, password: string, tenant: string): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("that is not an email address");
  await assertPasswordPolicy(password, normalized);
  assertSafeName(tenant, "account name");
  const users = await readUsers();
  if (users.some((u) => u.email === normalized)) throw Object.assign(new Error("that email already has an account"), { status: 409 });
  if (users.some((u) => u.tenant === tenant) || fs.existsSync(accountDir(tenant))) throw Object.assign(new Error("that account name is taken"), { status: 409 });
  const salt = crypto.randomBytes(16).toString("hex");
  const user: UserRecord = {
    id: crypto.randomBytes(8).toString("hex"),
    email: normalized, tenant, salt, hash: scrypt(password, salt),
    createdAt: new Date().toISOString(), owner: true,
  };
  await writeUsers([...users, user]);
  fs.mkdirSync(path.join(accountDir(tenant), "workspaces"), { recursive: true });
  ensureAccountFiles(tenant);
  // The account's own encryption key, minted the moment the account exists.
  // It used to be minted only at boot, so an account created after boot
  // kept its secrets under the install key until the next deploy. Idempotent
  // across replicas; a no-op without a database.
  await ensureTenantKey(tenant);
  return user;
}

export async function setUserTimezone(userId: string, tz: string | null): Promise<void> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  if (tz !== null && !isValidTimeZone(tz)) throw new Error(`not a known timezone: ${tz}`);
  if (tz === null) delete user.timezone;
  else user.timezone = tz;
  await writeUsers(users);
}

/** A person's own small settings, merged: `null` clears a key. */
export async function setUserPrefs(userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("no such user");
  const prefs: Record<string, unknown> = { ...(user.prefs ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete prefs[k];
    else prefs[k] = v;
  }
  user.prefs = Object.keys(prefs).length ? prefs : null;
  await writeUsers(users);
  return prefs;
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
    // A support view: live only while its grant is — ended or lapsed, the
    // token is nothing. It reads as the account's owner, marked read-only.
    const [tenant, id] = Buffer.from(subject, "base64url").toString().split(":");
    if (!tenant || !id) return null;
    const { billing } = await import("@/platform/billing");
    const view = await billing().liveSupportView(tenant, id);
    if (!view) return null;
    const owner = await ownerOf(tenant);
    if (!owner) return null;
    return { ...owner, viewAs: { id: view.id, by: view.by, reason: view.reason, expiresAt: view.expiresAt } };
  }
  if (version === "v2") {
    // The signature proves nobody forged the id. The row decides whether it is
    // still live — and refuses if there is no database to ask, because a token
    // that claims to be revocable and is checked against nothing is worse than
    // one that never claimed it.
    const live = await sessionAllowed(subject);
    if (!live) return null;
    return (await readUsers()).find((u) => u.id === live.userId) ?? null;
  }
  // v1: the pre-database form. Still accepted so that deploying revocable
  // sessions does not sign everybody out, and still minted where an install
  // has no database at all.
  return (await readUsers()).find((u) => u.id === subject) ?? null;
}
