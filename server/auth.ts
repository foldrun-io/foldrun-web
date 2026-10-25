// Workspace API keys. Keys look like `mda_<48 hex>`; only a SHA-256 hash is
// stored. A valid `Authorization: Bearer` key *is* the tenant — it overrides
// any x-foldrun-tenant header.
//
// Without a key the request is refused. `FOLDRUN_DEV_NO_AUTH=1` opts out and
// falls back to the x-foldrun-tenant header, which is what `next dev` sets.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { dataRoot } from "@/lib/paths.ts";
import { assertSafeName } from "@/lib/store.ts";
import { verifySession, SESSION_COOKIE, roleOfUser , allowedWorkspaces } from "./users.ts";
import { isRole, type Role } from "@/platform/permissions.ts";
import { supportViewRefusal } from "./view-as.ts";
import { databaseEnabled } from "@/platform/db.ts";
import {
  insertApiKeyDb,
  findApiKeyByHashDb,
  listApiKeysDb,
  revokeApiKeyDb,
  hasActiveKeysDb,
  importApiKeysDb,
  touchApiKeyDb,
  setApiKeyExpiryDb,
  expiringApiKeysDb,
  markExpiryWarnedDb,
  markApiKeyReplacedDb,
  type ApiKeyRow,
} from "@/platform/api-keys-db.ts";

// Follows FOLDRUN_DATA like everything else. This was the tenth copy of the
// data-root path and the last one still reading process.cwd() directly, so
// relocating the data directory moved every workspace, secret and run — and
// left the API keys behind in the old one, silently unauthenticating a server
// that looked correctly configured.
//
// With a database the keys are rows (`api_keys`, looked up by the hash's
// unique index); keys.json is then read once, at boot, by importApiKeys.
const keysFile = () => path.join(dataRoot(), "keys.json");

export interface ApiKeyRecord {
  id: string;
  hash: string;
  prefix: string; // first 12 chars, for display
  label: string;
  tenant: string;
  createdAt: string;
  /** Email of the member who created it, when a signed-in person did — the
   *  CLI/bootstrap path has no session, so it may be absent. */
  createdBy?: string;
  revokedAt: string | null;
  /**
   * A deploy key: one workspace, for the platform's own git, which went on
   * 17 Oct 2026. None are minted now; one minted before is refused
   * everywhere (resolveTenant), so a key pasted into CI for git can never
   * open the API instead.
   */
  scope?: { workspace: string; access: "read" | "write" };
  /**
   * What the key may do, in the same vocabulary as a member. Absent on keys
   * minted before roles existed, and read as `admin` — the power every key
   * had — so a deploy does not break a CI job. New keys are minted with a
   * role and default to `editor`: enough to run, deploy and edit, never
   * enough to read the vault or mint another key.
   */
  role?: Role;
  /**
   * Which workspaces the key may open; null (or absent) for all. Copied
   * from the minter at mint time and never wider than theirs: a member
   * given two workspaces mints keys that open those two. Absent on keys
   * minted before scopes existed, and read as all — what they always had.
   */
  workspaces?: string[] | null;
  /** When the key stops working: chosen at mint (30, 90 or 365 days, or
   *  never — null), and brought forward to the grace when it is rotated.
   *  An expired key is refused with a 401 that says so. */
  expiresAt?: string | null;
  /** When it last authenticated — written at most once a minute per key —
   *  and from where, coarsely: an IPv4 /24 or IPv6 /48, never the address. */
  lastUsedAt?: string | null;
  lastIp?: string | null;
  /** When the owner was mailed that it ends within a week; they are told once. */
  expiryWarnedAt?: string | null;
  /** The id of the key that replaced this one in a rotation; null until
   *  then. A key already replaced is not rotated again — the new key is. */
  replacedBy?: string | null;
}

/**
 * "30d", "90d", "365d", "never", a number of days — into the moment a key
 * stops working, or null for never. Anything else is refused rather than
 * guessed: a typo must not mint a key that lives forever.
 */
export function parseKeyExpiry(v: unknown, now = Date.now()): Date | null {
  if (v === undefined || v === null || v === "never" || v === "") return null;
  const days = typeof v === "number" ? v : typeof v === "string" && /^\d+d?$/.test(v.trim()) ? Number(v.trim().replace(/d$/, "")) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw Object.assign(new Error(`expires must be a number of days (1–3650), like 30d, 90d or 365d, or "never" — got ${JSON.stringify(v)}`), { status: 400 });
  }
  return new Date(now + days * 86_400_000);
}

/** A rotation's grace: "0", "1h", "24h" (or "30m", "2d") into milliseconds. */
export function parseGrace(v: unknown): number {
  if (v === undefined || v === null || v === "" || v === 0 || v === "0") return 0;
  const m = typeof v === "string" ? v.trim().match(/^(\d+)\s*(m|h|d)$/) : null;
  const ms = m ? Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"] : NaN;
  if (!Number.isFinite(ms) || ms < 0 || ms > 7 * 86_400_000) {
    throw Object.assign(new Error(`grace must be 0, or a duration up to 7d like 1h or 24h — got ${JSON.stringify(v)}`), { status: 400 });
  }
  return ms;
}

export const keyExpired = (k: Pick<ApiKeyRecord, "expiresAt">, now = Date.now()) => Boolean(k.expiresAt && Date.parse(k.expiresAt) <= now);

/** Where a request came from, coarsely: the first forwarded address cut to
 *  its /24 (IPv4) or /48 (IPv6). Enough to tell "the CI runner" from "a
 *  country I have never been to"; not enough to locate a person. */
export function coarseIp(headers: Headers): string | null {
  const raw = (headers.get("x-forwarded-for")?.split(",")[0] ?? headers.get("x-real-ip") ?? "").trim();
  if (!raw) return null;
  const v4 = raw.replace(/^::ffff:/, "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (raw.includes(":")) return `${raw.split(":").slice(0, 3).join(":")}::/48`;
  return null;
}

function readKeys(): ApiKeyRecord[] {
  if (!fs.existsSync(keysFile())) return [];
  return JSON.parse(fs.readFileSync(keysFile(), "utf8"));
}

function writeKeys(keys: ApiKeyRecord[]) {
  fs.mkdirSync(path.dirname(keysFile()), { recursive: true });
  // 0600 like the vault beside it. These are SHA-256 digests, not keys, so a
  // read does not yield anything usable — but it does yield every tenant name
  // and every key prefix, and there is no reason for it to be world-readable
  // when secrets.json next to it is not.
  fs.writeFileSync(keysFile(), JSON.stringify(keys, null, 2), { mode: 0o600 });
}

const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export async function createApiKey(
  tenant: string,
  label: string,
  createdBy?: string,
  scope?: ApiKeyRecord["scope"],
  role: Role = "editor",
  workspaces: string[] | null = null,
  opts: { expiresAt?: Date | null } = {},
): Promise<{ record: ApiKeyRecord; key: string }> {
  assertSafeName(tenant, "tenant");
  if (scope) throw new Error("deploy keys went with the platform's own git (17 Oct 2026)");
  if (!isRole(role) || role === "owner") throw new Error("a key can be viewer, editor or admin");
  if (workspaces) for (const w of workspaces) assertSafeName(w, "workspace");
  // A deploy key is visibly a deploy key, so it is never mistaken for an
  // account key when it turns up in a CI log.
  const key = `${scope ? "mdk" : "mda"}_${crypto.randomBytes(24).toString("hex")}`;
  const record: ApiKeyRecord = {
    id: crypto.randomBytes(6).toString("hex"),
    hash: hash(key),
    prefix: key.slice(0, 12),
    label: label || "unnamed",
    tenant,
    createdAt: new Date().toISOString(),
    ...(createdBy ? { createdBy } : {}),
    ...(scope ? { scope } : {}),
    role,
    workspaces,
    revokedAt: null,
    expiresAt: opts.expiresAt ? opts.expiresAt.toISOString() : null,
  };
  if (databaseEnabled()) await insertApiKeyDb(record as ApiKeyRow);
  else writeKeys([...readKeys(), record]);
  return { record, key }; // full key is returned exactly once
}

/** Every key record, or one account's: the table with a database, the file without. */
async function keysOf(tenant: string): Promise<ApiKeyRecord[]> {
  if (databaseEnabled()) return (await listApiKeysDb(tenant)) as ApiKeyRecord[];
  return readKeys().filter((k) => k.tenant === tenant);
}

async function keyByHash(h: string): Promise<ApiKeyRecord | null> {
  if (databaseEnabled()) return (await findApiKeyByHashDb(h)) as ApiKeyRecord | null;
  return readKeys().find((k) => k.hash === h) ?? null;
}

export async function listApiKeys(tenant: string): Promise<Omit<ApiKeyRecord, "hash">[]> {
  return (await keysOf(tenant)).map(({ hash: _hash, ...rest }) => rest);
}

export async function revokeApiKey(tenant: string, id: string): Promise<boolean> {
  if (databaseEnabled()) return revokeApiKeyDb(tenant, id);
  const keys = readKeys();
  const key = keys.find((k) => k.id === id && k.tenant === tenant);
  if (!key) return false;
  key.revokedAt = new Date().toISOString();
  writeKeys(keys);
  return true;
}

/** Bring a key's end forward to `at` — never back. */
async function shortenExpiry(tenant: string, id: string, at: Date): Promise<boolean> {
  if (databaseEnabled()) return setApiKeyExpiryDb(tenant, id, at);
  const keys = readKeys();
  const key = keys.find((k) => k.id === id && k.tenant === tenant);
  if (!key) return false;
  if (!key.expiresAt || Date.parse(key.expiresAt) > at.getTime()) key.expiresAt = at.toISOString();
  writeKeys(keys);
  return true;
}

/** Claim `id` as replaced by `by` — once. False when another rotation got
 *  there first (or the key is gone or revoked). */
async function markReplaced(tenant: string, id: string, by: string): Promise<boolean> {
  if (databaseEnabled()) return markApiKeyReplacedDb(tenant, id, by);
  const keys = readKeys();
  const key = keys.find((k) => k.id === id && k.tenant === tenant);
  if (!key || key.revokedAt || key.replacedBy) return false;
  key.replacedBy = by;
  writeKeys(keys);
  return true;
}

/** The 409 for rotating a key a rotation already replaced. Whoever lost the
 *  new key's secret wants to rotate the NEW key: that mints another and ends
 *  the lost one, where rotating the old key again would leave it live. */
function alreadyRotated(next: Pick<ApiKeyRecord, "prefix" | "label" | "revokedAt"> | undefined, nextId: string) {
  const which = next ? `${next.prefix}… ("${next.label}")` : nextId;
  const tail = next && !next.revokedAt
    ? `; rotate that one — if you lost its secret, rotating ${next.prefix}… mints another and ends it`
    : "; that key is gone too — mint a new one";
  return Object.assign(new Error(`this key was already rotated to ${which}${tail}`), { status: 409 });
}

/**
 * Rotate: a new key with the old one's label, role, workspaces and deploy
 * scope — and, when it had one, the same lifetime from today — then the old
 * one ends: at once with no grace, or when the grace runs out, so a CI job
 * can be moved to the new key before the old stops answering. The new key
 * is returned once, like any mint.
 */
export async function rotateApiKey(
  tenant: string,
  id: string,
  graceMs: number,
  by?: string,
): Promise<{ record: ApiKeyRecord; key: string; old: Omit<ApiKeyRecord, "hash">; oldEndsAt: string }> {
  const all = await keysOf(tenant);
  const old = all.find((k) => k.id === id);
  if (!old) throw Object.assign(new Error("key not found"), { status: 404 });
  // A rotated key names its replacement first: with no grace it is revoked,
  // and after the grace it has expired, but the answer is still "rotate the
  // new one", not "not found" or "mint a new one".
  if (old.replacedBy) throw alreadyRotated(all.find((k) => k.id === old.replacedBy), old.replacedBy);
  if (old.revokedAt) throw Object.assign(new Error("key not found"), { status: 404 });
  if (keyExpired(old)) throw Object.assign(new Error("that key has already expired — mint a new one instead"), { status: 409 });
  const lifetime = old.expiresAt ? Date.parse(old.expiresAt) - Date.parse(old.createdAt) : null;
  const made = await createApiKey(tenant, old.label, by ?? old.createdBy, old.scope, (old.role ?? "admin") === "owner" ? "admin" : (old.role ?? "admin"), old.workspaces ?? null, {
    expiresAt: lifetime && lifetime > 0 ? new Date(Date.now() + lifetime) : null,
  });
  // Claim the old key before ending it. Two rotations at once both pass the
  // check above; only one claim lands, and the loser's key is revoked unseen.
  if (!(await markReplaced(tenant, id, made.record.id))) {
    await revokeApiKey(tenant, made.record.id);
    const after = await keysOf(tenant);
    const winner = after.find((k) => k.id === id)?.replacedBy;
    if (winner) throw alreadyRotated(after.find((k) => k.id === winner), winner);
    throw Object.assign(new Error("key not found"), { status: 404 });
  }
  const endsAt = new Date(Date.now() + graceMs);
  if (graceMs <= 0) await revokeApiKey(tenant, id);
  else {
    await shortenExpiry(tenant, id, endsAt);
    // The grace is an end the owner chose just now: the week's-notice mail
    // ("your key expires — rotate it") would tell them to do what they did.
    await markExpiryWarned(id);
  }
  const { hash: _h, ...rest } = old;
  return { ...made, old: rest, oldEndsAt: endsAt.toISOString() };
}

// When each key last wrote its last-used time, in this process. Once a
// minute per key is plenty for "last used" and keeps a busy CI key from
// turning every request into a write.
const touched = new Map<string, number>();
const TOUCH_EVERY_MS = 60_000;

/** Note that a key authenticated. Best-effort: a failed write must never
 *  fail the request it was describing. */
async function noteKeyUse(record: ApiKeyRecord, headers: Headers, now = Date.now()): Promise<void> {
  const last = touched.get(record.id) ?? (record.lastUsedAt ? Date.parse(record.lastUsedAt) : 0);
  if (now - last < TOUCH_EVERY_MS) return;
  touched.set(record.id, now);
  const ip = coarseIp(headers) ?? record.lastIp ?? null;
  try {
    if (databaseEnabled()) await touchApiKeyDb(record.id, new Date(now), ip);
    else {
      const keys = readKeys();
      const key = keys.find((k) => k.id === record.id);
      if (key) {
        key.lastUsedAt = new Date(now).toISOString();
        key.lastIp = ip;
        writeKeys(keys);
      }
    }
  } catch (err) {
    console.error("[keys] could not record last use:", err instanceof Error ? err.message : err);
  }
}

/** For tests: forget the once-a-minute memory. */
export function resetKeyTouches(): void {
  touched.clear();
}

/** Live keys, every account's, that end before `before` and whose owner has
 *  not been told. */
export async function expiringKeys(before: Date): Promise<ApiKeyRecord[]> {
  if (databaseEnabled()) return (await expiringApiKeysDb(before)) as ApiKeyRecord[];
  return readKeys().filter((k) => !k.revokedAt && !k.expiryWarnedAt && k.expiresAt && Date.parse(k.expiresAt) <= before.getTime());
}

export async function markExpiryWarned(id: string, at = new Date()): Promise<void> {
  if (databaseEnabled()) return markExpiryWarnedDb(id, at);
  const keys = readKeys();
  const key = keys.find((k) => k.id === id);
  if (!key) return;
  key.expiryWarnedAt = at.toISOString();
  writeKeys(keys);
}

export async function hasActiveKeys(tenant: string): Promise<boolean> {
  if (databaseEnabled()) return hasActiveKeysDb(tenant);
  return readKeys().some((k) => k.tenant === tenant && !k.revokedAt);
}

/**
 * keys.json into the table, once, at boot. Keys already there are left alone
 * (a re-import can never un-revoke one). The file is then renamed aside, not
 * deleted: it holds only hashes, and it is what a rollback to files would
 * read. Returns how many were added.
 */
export async function importApiKeys(): Promise<number> {
  if (!databaseEnabled() || !fs.existsSync(keysFile())) return 0;
  const n = await importApiKeysDb(readKeys() as ApiKeyRow[]);
  fs.renameSync(keysFile(), `${keysFile()}.imported-${new Date().toISOString().slice(0, 10)}`);
  return n;
}

/**
 * Who is calling, resolved once. A person carries their role; a key carries
 * the role it was minted with (or `admin`, for keys older than roles). `id`
 * names the person, or the key's id — never a person for a key, because a
 * key is an account credential and inventing an actor would be worse than
 * saying so.
 */
export interface Actor {
  kind: "user" | "key";
  id: string;
  /** What a revision's `by` records: the person's email; for a key, the
   *  email it was minted by, else `key:<label>`. */
  name: string;
  role: Role;
  /** Which workspaces this caller may open; null for all. A key opens the
   *  workspaces it was minted with — its minter's scope. */
  workspaces: string[] | null;
  /** A support view: reads as the owner, refused every write. */
  readOnly?: boolean;
}

export type AuthResult =
  | { tenant: string; actor: Actor }
  | { tenant: null; status: number; message: string };

/**
 * The key's record — tenant, role, which workspaces it opens and, for a
 * deploy key, its git scope. Role and workspaces are resolved the way
 * resolveTenant resolves them (a key older than roles is an admin of every
 * workspace), so the git endpoint and the API answer the same question the
 * same way. This used to return the tenant and the deploy scope only, and
 * the git endpoint therefore let any key of the account push any
 * workspace — a viewer's key included.
 */
export async function apiKeyFor(
  presented: string,
  /** The request's headers, for the coarse address last use records. Pass
   *  them: the rate-limit gate looks the key up before the route does, and
   *  the once-a-minute guard then skips the route's own note — so a lookup
   *  without them left lastIp empty for every Bearer caller. */
  headers: Headers = new Headers(),
): Promise<{ tenant: string; label: string; prefix: string; role: Role; workspaces: string[] | null; scope?: ApiKeyRecord["scope"] } | null> {
  const record = await keyByHash(hash(presented.trim()));
  // A deploy key opens nothing since the platform's own git went: refused
  // here as well as in resolveTenant, so no caller of this lookup (the rate
  // gate today, whatever reads keys tomorrow) can treat one as live.
  if (!record || record.revokedAt || keyExpired(record) || record.scope) return null;
  await noteKeyUse(record, headers);
  return {
    tenant: record.tenant,
    // How a person recognises the key (API usage, deprecation warnings) —
    // the label it was given and its display prefix, never the secret.
    label: record.label,
    prefix: record.prefix,
    role: record.role ?? "admin",
    workspaces: record.workspaces ?? null,
    ...(record.scope ? { scope: record.scope } : {}),
  };
}

export async function resolveTenant(req: NextRequest): Promise<AuthResult> {
  const authz = req.headers.get("authorization");
  // `Bearer` however it is capitalised: a hand-written script that sends
  // `bearer` is not a different scheme.
  if (authz && /^bearer\s/i.test(authz)) {
    const presented = authz.replace(/^bearer\s+/i, "").trim();
    const record = await keyByHash(hash(presented));
    if (!record) return { tenant: null, status: 401, message: "invalid API key" };
    if (record.revokedAt) return { tenant: null, status: 401, message: "API key revoked" };
    if (keyExpired(record)) {
      return { tenant: null, status: 401, message: `API key expired on ${record.expiresAt!.slice(0, 10)} — mint a new one on Settings → API keys (or \`foldrun keys create\`); rotate a key before it ends to keep its role and scope` };
    }
    // A deploy key opened the platform's own git and nothing else; with that
    // git gone it opens nothing.
    if (record.scope) return { tenant: null, status: 403, message: "this is a deploy key — they went with the platform's own git (17 Oct 2026); mint an account key instead" };
    await noteKeyUse(record, req.headers);
    return {
      tenant: record.tenant,
      // The workspaces the key was minted for — its minter's, at the time.
      // Null on keys from before scopes: everything, as they always had.
      // What a revision's `by` records: the person the key was made for
      // when a signed-in person minted it (the CLI's `foldrun login` key,
      // every key from the Settings page), else the key by its label — a
      // history of "api-key" said nothing about who changed the file.
      actor: { kind: "key", id: record.id, name: record.createdBy ?? `key:${record.label || record.prefix}`, role: record.role ?? "admin", workspaces: record.workspaces ?? null },
    };
  }
  // The dashboard's own fetches carry no Bearer key — they carry the session
  // cookie, same-origin. Verifying it here keeps one funnel for every API
  // caller instead of a parallel "browser API".
  {
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (session?.viewAs) {
      // Support, viewing as the owner: every read the owner has, no write.
      // Enforced here, in the funnel, not in proxy.ts (server/view-as.ts):
      // the proxy cannot refuse a support token's writes wholesale, because
      // the super admin console stays usable during a view (its routes read
      // the parked session — server/admin/index.ts ownToken).
      const refused = supportViewRefusal(req.method, req.nextUrl.pathname);
      if (refused) return { tenant: null, status: 403, message: refused };
      return {
        tenant: session.tenant,
        actor: { kind: "user", id: session.id, name: `support:${session.viewAs.by}`, role: "owner", workspaces: null, readOnly: true },
      };
    }
    if (session) {
      return {
        tenant: session.tenant,
        actor: { kind: "user", id: session.id, name: session.email, role: (await roleOfUser(session.tenant, session.id)) ?? "viewer", workspaces: await allowedWorkspaces(session.tenant, session.id) },
      };
    }
  }

  // Fail closed. This used to be the other way round — no key meant "trust the
  // x-foldrun-tenant header" unless FOLDRUN_REQUIRE_AUTH=1 was set — so a
  // deployment that reached the internet before someone remembered the flag
  // let anyone read every workspace and write any secret. A missing flag
  // should refuse, not admit; the safe state is the one you get by default.
  //
  // Local development opts out explicitly, and only `next dev` sets it.
  if (process.env.FOLDRUN_DEV_NO_AUTH === "1") {
    // Dev mode has no person and no key; it is the owner of whatever tenant
    // the header names, because that is what it always was.
    return {
      tenant: req.headers.get("x-foldrun-tenant") ?? "default",
      actor: { kind: "key", id: "dev", name: "dev", role: "owner", workspaces: null },
    };
  }
  return {
    tenant: null,
    status: 401,
    message:
      "missing API key (Authorization: Bearer mda_...). Set FOLDRUN_DEV_NO_AUTH=1 to allow " +
      "unauthenticated local requests.",
  };
}
