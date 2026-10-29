// What people did.
//
// The runs directory already records what AGENTS did, in detail, forever. What
// was nowhere is the other half: who signed in, who ended a session, who
// changed a password, who minted a key. That is the half an auditor asks for,
// and the half you want on the day something is wrong.
//
// Best-effort by design: a failure here must never fail the action it was
// describing. Refusing a login because the audit insert failed would turn an
// observability outage into an authentication outage.

import fs from "node:fs";
import path from "node:path";
import { orm, auditLog, and, desc, eq, gte, lt, lte, sql } from "@/platform/orm";
import { dataRoot } from "@/lib/paths.ts";

export type AuditAction =
  | "login"
  // The kill switch: a person or key paused or resumed runs (server/pause.ts).
  | "account.paused"
  | "account.resumed"
  | "workspace.paused"
  | "workspace.resumed"
  | "login.refused"
  | "logout"
  | "session.revoked"
  | "password.changed"
  | "password.reset_requested"
  | "password.reset"
  | "email.verified"
  | "email.changed"
  | "mfa.enabled"
  | "mfa.disabled"
  | "mfa.refused"
  | "account.created"
  | "timezone.changed"
  | "apikey.created"
  | "apikey.revoked"
  | "member.invited"
  // An invite taken back before it was used: by a person, by a newer
  // invite to the same address, or because its maker or addressee left
  // the team or was narrowed (29 Oct 2026).
  | "member.invite_revoked"
  | "member.joined"
  // Keys over their whole life: minted, rotated (the new one's id is the
  // subject, the old one's in detail), revoked by a person.
  | "apikey.rotated"
  // The vault, by NAME only — a value never reaches this table.
  | "secret.set"
  | "secret.deleted"
  // Bound to sites, or unbound: where the egress proxy may send it.
  | "secret.sites"
  | "model.key_set"
  | "model.key_removed"
  // What went live, and what went away.
  | "workspace.deployed"
  | "workspace.deleted"
  // A package taken out, or brought in (export/import routes).
  | "workspace.exported"
  | "workspace.imported"
  // Support opened this account read-only, and the view ended. The customer
  // reads these in their own audit log: "support viewed your account".
  | "support.viewed"
  | "support.ended"
  | "member.role_changed"
  | "member.scope_changed"
  | "member.removed"
  | "owner.transferred"
  // The owner's own data and exit: a copy taken, a close asked for.
  | "account.exported"
  | "account.close_requested"
  // The super admin's levers on a customer — mirrored here from the super admin's
  // own durable file (platform/admin.ts), so an auditor's one query over
  // this table also sees what the platform did TO an account, not only what
  // the account's people did in it.
  | "operator.credit"
  | "operator.debit"
  | "operator.plan"
  | "operator.notes"
  | "operator.suspend"
  | "operator.restore"
  | "operator.reset_password"
  | "operator.reset_link"
  | "operator.account_created"
  | "operator.overdraft"
  | "operator.waive"
  | "operator.grant_plan"
  // Plans: what the customer asked for (here) and what Stripe then did
  // (mirrored from the platform's own audit as it lands).
  | "plan.change_requested"
  | "plan.change_pending"
  | "plan.cancel_requested"
  | "plan.resumed"
  | "plan.cycle"
  | "plan.past_due"
  | "billing.event"
  // Who the invoices are made out to, changed by the owner.
  | "billing.details"
  // A Stripe event re-processed by the super admin from the webhook log.
  | "billing.replay"
  | "plan.ended"
  // A workspace's source rolled back to a point in its history, and a
  // customer asking the operator for a restore from a nightly backup.
  | "workspace.restored"
  | "backup.restore_requested";

// Without a database the log is a file per account, appended a line at a
// time — the same shape the super admin's own audit has kept without one
// (platform/admin.ts). An install that never had Postgres used to drop every
// entry on the floor, and so had no audit log at all.
const SAFE_TENANT = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const auditFile = (tenant: string) => path.join(dataRoot(), "audit", `${tenant}.jsonl`);

export async function audit(
  action: AuditAction,
  opts: { actor: string; tenant?: string | null; subject?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  const q = orm();
  try {
    if (!q) {
      if (!opts.tenant || !SAFE_TENANT.test(opts.tenant)) return;
      const file = auditFile(opts.tenant);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // O_APPEND: a whole line lands whole when two requests write at once.
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), actor: opts.actor, action, subject: opts.subject ?? null, detail: opts.detail ?? {} }) + "\n", { mode: 0o600 });
      return;
    }
    await q.insert(auditLog).values({ tenant: opts.tenant ?? null, actor: opts.actor, action, subject: opts.subject ?? null, detail: opts.detail ?? {} });
  } catch (err) {
    console.error("[audit] could not record", action, err instanceof Error ? err.message : err);
  }
}

export interface AuditEntry {
  /** Opaque, stable, increasing: what `cursor` takes. */
  id: string;
  at: string;
  actor: string;
  action: string;
  subject: string | null;
  detail: Record<string, unknown>;
}

export interface AuditQuery {
  tenant: string;
  since?: Date;
  until?: Date;
  /** An exact action (`apikey.created`) or a family (`apikey`, `apikey.*`). */
  action?: string;
  /** Who did it — an email, `key:<label>`, `support`. Exact. */
  actor?: string;
  /** Entries about one workspace (their detail names it). */
  workspace?: string;
  limit?: number;
  /** The `next` of the page before: entries strictly older than it. */
  cursor?: string;
}

/**
 * What a customer's own audit log does not show: the super admin's levers
 * (`operator.*` — credits, internal notes, plan overrides), which are the
 * platform's record about the account rather than the account's record.
 * What support did IN the account is written to both, as `support.*`.
 */
const customerVisible = (action: string) => !action.startsWith("operator.");

function matches(e: AuditEntry, f: AuditQuery): boolean {
  if (!customerVisible(e.action)) return false;
  const t = Date.parse(e.at);
  if (f.since && t < f.since.getTime()) return false;
  if (f.until && t > f.until.getTime()) return false;
  if (f.action) {
    const fam = f.action.replace(/\.\*$/, "");
    if (e.action !== f.action && !e.action.startsWith(`${fam}.`) && e.action !== fam) return false;
  }
  if (f.actor && e.actor !== f.actor) return false;
  if (f.workspace && e.detail?.workspace !== f.workspace) return false;
  return true;
}

/**
 * One account's audit log, newest first, a page at a time. Always one
 * account: the tenant is the caller's, decided by the route, and the query
 * cannot be widened past it.
 *
 * Retention: no plan sets one, so entries are kept for the life of the
 * account — they go when the account is deleted, and the `tenant.deleted`
 * entry for that stays on the platform's side.
 */
export async function queryAudit(f: AuditQuery): Promise<{ entries: AuditEntry[]; next: string | null }> {
  const limit = Math.max(1, Math.min(f.limit ?? 100, 1000));
  const q = orm();
  if (!q) {
    if (!SAFE_TENANT.test(f.tenant)) return { entries: [], next: null };
    let lines: string[];
    try {
      lines = fs.readFileSync(auditFile(f.tenant), "utf8").split("\n");
    } catch {
      return { entries: [], next: null };
    }
    // The id is the line's number: lines are only ever appended, so it is
    // stable and increasing, which is all a cursor needs.
    const start = f.cursor && /^\d+$/.test(f.cursor) ? Math.min(Number(f.cursor), lines.length) - 1 : lines.length - 1;
    const entries: AuditEntry[] = [];
    let i = start;
    for (; i >= 0 && entries.length < limit; i--) {
      if (!lines[i]) continue;
      let e: AuditEntry;
      try {
        e = { id: String(i), ...(JSON.parse(lines[i]) as Omit<AuditEntry, "id">) };
      } catch {
        continue; // a torn line from a crash mid-write is skipped, not fatal
      }
      if (matches(e, f)) entries.push(e);
    }
    const more = entries.length === limit && i >= 0;
    return { entries, next: more ? entries[entries.length - 1].id : null };
  }
  const where = [eq(auditLog.tenant, f.tenant), sql`${auditLog.action} NOT LIKE 'operator.%'`];
  if (f.since) where.push(gte(auditLog.at, f.since));
  if (f.until) where.push(lte(auditLog.at, f.until));
  if (f.action) {
    const fam = f.action.replace(/\.\*$/, "");
    where.push(sql`(${auditLog.action} = ${f.action} OR ${auditLog.action} = ${fam} OR ${auditLog.action} LIKE ${fam.replace(/[%_\\]/g, "\\$&") + ".%"})`);
  }
  if (f.actor) where.push(eq(auditLog.actor, f.actor));
  if (f.workspace) where.push(sql`${auditLog.detail}->>'workspace' = ${f.workspace}`);
  if (f.cursor && /^\d+$/.test(f.cursor)) where.push(lt(auditLog.id, Number(f.cursor)));
  const rows = await q
    .select({ id: auditLog.id, at: auditLog.at, actor: auditLog.actor, action: auditLog.action, subject: auditLog.subject, detail: auditLog.detail })
    .from(auditLog)
    .where(and(...where))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    at: r.at.toISOString(),
    actor: r.actor,
    action: r.action,
    subject: r.subject,
    detail: (r.detail as Record<string, unknown>) ?? {},
  }));
  return { entries: page, next: rows.length > limit ? page[page.length - 1].id : null };
}

/** The entries as CSV: one row each, detail as compact JSON. */
export function auditCsv(entries: AuditEntry[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
    // A leading =, +, - or @ is a formula to a spreadsheet: neutralise it.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = "id,at,actor,action,subject,workspace,detail";
  return [head, ...entries.map((e) => [e.id, e.at, e.actor, e.action, e.subject, e.detail?.workspace ?? "", e.detail].map(cell).join(","))].join("\n") + "\n";
}

/** Recent entries for one account, newest first. */
export async function recentAudit(tenant: string, limit = 50) {
  const q = orm();
  if (!q) return (await queryAudit({ tenant, limit: Math.min(limit, 200) })).entries.map(({ id: _id, ...e }) => e);
  const rows = await q
    .select({ at: auditLog.at, actor: auditLog.actor, action: auditLog.action, subject: auditLog.subject, detail: auditLog.detail })
    .from(auditLog)
    .where(eq(auditLog.tenant, tenant))
    .orderBy(desc(auditLog.at))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    at: r.at.toISOString(),
    actor: r.actor,
    action: r.action,
    subject: r.subject,
    detail: r.detail as Record<string, unknown>,
  }));
}

/** "7d", "24h", "30m", or a date/ISO time — into a moment. */
export function parseWhen(v: string | null, now = Date.now()): Date | undefined {
  if (!v) return undefined;
  const rel = v.trim().match(/^(\d+)\s*(m|h|d)$/);
  if (rel) return new Date(now - Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "m" | "h" | "d"]);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw Object.assign(new Error(`expected a time like 7d, 24h or 2026-09-01 — got "${v}"`), { status: 400 });
  return new Date(t);
}
