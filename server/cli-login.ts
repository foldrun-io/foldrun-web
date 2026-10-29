// Signing the CLI in from the browser.
//
// `foldrun login` should work the way Vercel's or Fly's does: the terminal
// shows a short code and opens the dashboard, the person confirms it there,
// and the terminal is signed in — no key to copy. Underneath it is the
// device-authorization shape: the CLI holds a secret request id nobody else
// ever sees, the browser sees only the code, and the two are joined by the
// row here. Approval mints an ordinary API key at the person's own role, so
// what the CLI holds afterwards is nothing new — it is a key on the Settings
// page, labelled with the machine, revocable like any other.
//
// Rows live in Postgres when the install has one (`cli_logins`, and the key
// is handed over by a single DELETE … RETURNING, so two polls can never both
// collect it), else in `<dataRoot>/cli-logins.json`, 0600 like keys.json
// beside it — a request has to be findable by whichever web process the
// browser lands on. They are short-lived: ten minutes, and gone the moment
// the key is collected. The minted key waits encrypted, under the account's
// key, in either store.

import { audit } from "./audit.ts";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataRoot } from "@/lib/paths.ts";
import { encryptValue, decryptValue } from "@/lib/secrets.ts";
import { databaseEnabled } from "@/platform/db.ts";
import {
  sweepCliLoginsDb,
  insertCliLoginDb,
  findCliLoginByCodeDb,
  decideCliLoginDb,
  claimCliLoginDb,
  unclaimCliLoginDb,
  pollCliLoginDb,
} from "@/platform/short-lived-db.ts";
import { createApiKey, revokeApiKey, CLI_KEY_DAYS } from "./auth.ts";

/** A `foldrun login` key ends after CLI_KEY_DAYS unless the CLI renews it
 *  (FOL-71) — before, it lived until someone revoked it by hand. */
const cliKeyLife = () => ({ expiresAt: new Date(Date.now() + CLI_KEY_DAYS * 86_400_000), origin: "cli-login" as const });
import type { Role } from "@/platform/permissions.ts";

const file = () => path.join(dataRoot(), "cli-logins.json");
const TTL_MS = 10 * 60 * 1000;
/** How long the CLI is told to wait between polls. */
export const POLL_SECONDS = 3;
/** The most requests one install keeps at once — the endpoint is open. */
const MAX_PENDING = 200;

export interface CliLogin {
  /** The secret the CLI polls with. Only the CLI ever holds it. */
  id: string;
  /** What the browser shows and the person confirms: `XXXX-XXXX`. */
  code: string;
  /** The machine asking, as the CLI reports it — for the label on the key. */
  hostname: string;
  createdAt: string;
  expiresAt: string;
  /** `approving`: won by a person, its key being minted — still pending to the CLI. */
  status: "pending" | "approving" | "approved" | "denied";
  /** Set on approval, delivered to the CLI exactly once, then the row goes.
   *  Its `key` is encrypted in the store and opened only on delivery. */
  grant?: SealedGrant;
}

type Grant = { key: string; tenant: string; email: string; role: Role };
type SealedGrant = Omit<Grant, "key"> & { key: ReturnType<typeof encryptValue> | string };

const seal = (g: Grant): SealedGrant => ({ ...g, key: encryptValue(g.tenant, g.key) });
/** A grant written before 2026-09-24 carries its key in the clear. */
function open(g: SealedGrant): Grant | null {
  const key = typeof g.key === "string" ? g.key : decryptValue(g.tenant, g.key);
  return key === null ? null : { ...g, key };
}

function read(): CliLogin[] {
  if (!fs.existsSync(file())) return [];
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as CliLogin[];
  } catch {
    return [];
  }
}

/** Change one request in the file store from a fresh read — never from a
 *  copy held across an await, which would write back over a request another
 *  approval changed meanwhile (Codex review of FOL-94). */
function updateRow(id: string, change: (r: CliLogin) => void): void {
  const fresh = read();
  const r = fresh.find((x) => x.id === id);
  if (!r) return;
  change(r);
  write(fresh);
}

function write(rows: CliLogin[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(rows, null, 2), { mode: 0o600 });
}

const live = (r: CliLogin, now = Date.now()) => Date.parse(r.expiresAt) > now;

// Unambiguous characters only: no 0/O, 1/I/L, so a code read aloud or
// typed from a phone screen is the code that was shown.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode(taken: Set<string>): string {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
    const code = `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
    if (!taken.has(code)) return code;
  }
}

/** A new request. The CLI keeps `id`; the person sees `code`. */
export async function beginCliLogin(hostname: string): Promise<CliLogin> {
  const now = Date.now();
  const cleanHost = hostname.replace(/[^\w.-]/g, "").slice(0, 64) || "unknown";
  if (databaseEnabled()) {
    if ((await sweepCliLoginsDb()) >= MAX_PENDING) throw new Error("too many sign-in requests waiting — try again in a few minutes");
    for (;;) {
      const row: CliLogin = {
        id: crypto.randomBytes(24).toString("hex"),
        code: newCode(new Set()),
        hostname: cleanHost,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_MS).toISOString(),
        status: "pending",
      };
      const inserted = await insertCliLoginDb({
        id: row.id,
        code: row.code,
        hostname: row.hostname,
        status: "pending",
        createdAt: new Date(row.createdAt),
        expiresAt: new Date(row.expiresAt),
      });
      if (inserted) return row; // else the code was taken: draw another
    }
  }
  const rows = read().filter((r) => live(r, now));
  if (rows.length >= MAX_PENDING) throw new Error("too many sign-in requests waiting — try again in a few minutes");
  const row: CliLogin = {
    id: crypto.randomBytes(24).toString("hex"),
    code: newCode(new Set(rows.map((r) => r.code))),
    hostname: cleanHost,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    status: "pending",
  };
  write([...rows, row]);
  return row;
}

/** What the browser needs to show before the person decides. */
export async function describeCliLogin(
  code: string,
): Promise<Pick<CliLogin, "code" | "hostname" | "expiresAt" | "status"> | null> {
  if (databaseEnabled()) {
    const r = await findCliLoginByCodeDb(normaliseCode(code));
    return r ? { code: r.code, hostname: r.hostname, expiresAt: r.expiresAt.toISOString(), status: r.status } : null;
  }
  const row = read().find((r) => r.code === normaliseCode(code) && live(r));
  if (!row) return null;
  const { hostname, expiresAt, status } = row;
  return { code: row.code, hostname, expiresAt, status };
}

/**
 * The person's decision. Approval mints the key at their role — an owner's
 * CLI is an admin's, since a key can never be an owner — labelled with the
 * machine, so the Settings page says where it went.
 */
export async function decideCliLogin(
  code: string,
  decision: "approve" | "deny",
  person: { tenant: string; email: string; role: Role; workspaces?: string[] | null },
): Promise<"approved" | "denied" | "not-found"> {
  if (databaseEnabled()) {
    const c = normaliseCode(code);
    const row = await findCliLoginByCodeDb(c);
    if (!row || row.status !== "pending") return "not-found";
    if (decision === "deny") return (await decideCliLoginDb(c, "denied", null)) ? "denied" : "not-found";
    // Win the request first, then mint: two approvals at once used to mint
    // two keys, and the loser's lived on, delivered to nobody (FOL-94).
    if (!(await claimCliLoginDb(c))) return "not-found";
    const role: Role = person.role === "owner" ? "admin" : person.role;
    let minted: Awaited<ReturnType<typeof createApiKey>>;
    try {
      minted = await createApiKey(person.tenant, `cli · ${row.hostname}`, person.email, undefined, role, person.workspaces ?? null, cliKeyLife());
    } catch (err) {
      await unclaimCliLoginDb(c).catch(() => {});
      throw err;
    }
    const { key, record } = minted;
    await audit("apikey.created", { actor: person.email, tenant: person.tenant, subject: record.id, detail: { label: record.label, prefix: record.prefix, role, via: "foldrun login" } });
    const grant = seal({ key, tenant: person.tenant, email: person.email, role });
    if (await decideCliLoginDb(c, "approved", grant as unknown as Record<string, unknown>)) return "approved";
    // It expired between the claim and now: the key would reach no one.
    await revokeApiKey(person.tenant, record.id).catch(() => {});
    return "not-found";
  }
  const rows = read();
  const row = rows.find((r) => r.code === normaliseCode(code) && live(r) && r.status === "pending");
  if (!row) return "not-found";
  if (decision === "deny") {
    row.status = "denied";
    write(rows);
    return "denied";
  }
  const role: Role = person.role === "owner" ? "admin" : person.role;
  // Claimed before the key exists, as on the database path.
  row.status = "approving";
  write(rows);
  // The person's own scope rides along: a member given two workspaces
  // gets a CLI that opens those two.
  let minted: Awaited<ReturnType<typeof createApiKey>>;
  try {
    minted = await createApiKey(person.tenant, `cli · ${row.hostname}`, person.email, undefined, role, person.workspaces ?? null, cliKeyLife());
  } catch (err) {
    updateRow(row.id, (r) => void (r.status = "pending"));
    throw err;
  }
  const { key, record } = minted;
  await audit("apikey.created", { actor: person.email, tenant: person.tenant, subject: record.id, detail: { label: record.label, prefix: record.prefix, role, via: "foldrun login" } });
  const grant = seal({ key, tenant: person.tenant, email: person.email, role });
  updateRow(row.id, (r) => {
    r.status = "approved";
    r.grant = grant;
  });
  return "approved";
}

/**
 * The CLI asking whether it is signed in yet. An approved request answers
 * with the key once and is removed: a second poll with the same id finds
 * nothing, which is the point — the key is delivered to one process.
 */
export async function pollCliLogin(id: string): Promise<
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; grant: Grant }
> {
  if (databaseEnabled()) {
    const got = await pollCliLoginDb(id);
    if (got.state !== "decided") return { status: got.state };
    const grant = got.row.grant ? open(got.row.grant as unknown as SealedGrant) : null;
    if (got.row.status === "denied" || !grant) return { status: "denied" };
    return { status: "approved", grant };
  }
  const rows = read();
  const row = rows.find((r) => r.id === id);
  if (!row) return { status: "expired" };
  if (!live(row)) {
    write(rows.filter((r) => r !== row));
    return { status: "expired" };
  }
  if (row.status === "pending" || row.status === "approving") return { status: "pending" };
  write(rows.filter((r) => r !== row));
  const grant = row.grant ? open(row.grant) : null;
  if (row.status === "denied" || !grant) return { status: "denied" };
  return { status: "approved", grant };
}

/** `abcd1234`, `ABCD-1234`, `abcd 1234` all name the same request. */
export function normaliseCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : raw.toUpperCase();
}
