// Settings → Audit log: what people did in this account — sign-ins, keys,
// invites, secrets by name, deploys, plan changes, and support's visits —
// newest first, filtered, a page at a time, and as CSV for an auditor.
//
// The same reader as GET /api/audit, with the same gate: the owner and
// admins who can see the whole account.

import Link from "@foldrun/ui/react/link";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { SettingsShell } from "@/components/settings-shell";
import { EmptyState, Chip, type Tone } from "@foldrun/ui/react/page";
import { Button, buttonVariants } from "@foldrun/ui/react/button";
import { Download, ScrollText } from "lucide-react";
import { settingsTabs } from "../tabs";
import { verifySession, SESSION_COOKIE, viewerRole, viewerScope } from "@/server/users";
import { cookies } from "next/headers";
import { LocalTime } from "@/components/local-time";
import { can } from "@/platform/permissions";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces } from "@/lib/store";
import { queryAudit, parseWhen, type AuditEntry } from "@/server/audit";
import { WithEmails } from "@/components/email";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log · Settings" };

const FAMILIES = ["login", "logout", "session", "password", "mfa", "email", "apikey", "member", "owner", "secret", "workspace", "support", "account", "plan", "billing"];
const WINDOWS = [
  { v: "24h", label: "Last 24 hours" },
  { v: "7d", label: "Last 7 days" },
  { v: "30d", label: "Last 30 days" },
  { v: "90d", label: "Last 90 days" },
  { v: "", label: "All time" },
];

const toneOf = (action: string): Tone =>
  action.startsWith("support.") ? "warn" : /refused|revoked|deleted|removed|disabled|close/.test(action) ? "bad" : /created|enabled|joined|invited/.test(action) ? "good" : "default";

/** One line a person reads, from an entry's detail — never the raw JSON. */
function describe(e: AuditEntry): string {
  const d = e.detail ?? {};
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (e.action) {
    case "support.viewed":
      return `Support viewed your account (read-only, until ${s("until").slice(11, 16)} UTC): ${s("reason")}`;
    case "support.ended":
      return `Support's view ended: ${s("reason")}`;
    case "apikey.created":
      return `${s("label")} (${s("prefix")}…) · ${s("role") || "editor"}${s("expiresAt") ? ` · expires ${s("expiresAt").slice(0, 10)}` : " · never expires"}${s("via") ? ` · via ${s("via")}` : ""}`;
    case "apikey.rotated":
      return `${s("label")}: new ${s("prefix")}… replaces ${s("replacesPrefix")}…, which ends ${s("oldEndsAt").slice(0, 16).replace("T", " ")} UTC`;
    case "apikey.revoked":
      return `${s("label")} (${s("prefix")}…)`;
    case "apikey.models": {
      const m = (d.models && typeof d.models === "object" ? d.models : {}) as Record<string, string>;
      const parts = Object.entries(m).map(([t, v]) => `${t} → ${v}`);
      return `${s("label")} (${s("prefix")}…): ${parts.length ? parts.join(", ") : "runs Claude Code's models as named"}`;
    }
    case "secret.set":
    case "secret.deleted":
      return `${s("name")}${s("kind") ? ` (${s("kind")})` : ""}${s("workspace") ? ` in ${s("workspace")}` : " (account)"}`;
    case "secret.sites": {
      const sites = Array.isArray(d.sites) ? (d.sites as string[]) : [];
      return `${s("name")}${s("workspace") ? ` in ${s("workspace")}` : " (account)"} · ${sites.length ? `bound to ${sites.join(", ")}` : "unbound"}`;
    }
    case "secret.workspaces": {
      const list = Array.isArray(d.workspaces) ? (d.workspaces as string[]) : null;
      return `${s("name")} (account) · ${list === null ? "every workspace" : list.length ? `only ${list.join(", ")}` : "no workspace"}`;
    }
    case "workspace.deployed":
      return `${s("workspace")}${s("commit") ? ` @ ${s("commit").slice(0, 8)}` : ""} · +${d.added ?? 0} ~${d.updated ?? 0} −${d.removed ?? 0}`;
    case "workspace.exported":
      return `${s("kind") === "workspace" ? s("workspace") : `${s("kind")} ${s("name")} from ${s("workspace")}`} · ${d.files ?? 0} files`;
    case "workspace.imported":
      return `${s("kind") === "workspace" ? "workspace" : `${s("kind")} ${s("name")}`}${s("from") ? ` from ${s("from")}` : ""} into ${s("workspace")}${d.created ? " (new)" : ""} · ${d.written ?? 0} files${d.overwritten ? `, ${d.overwritten} overwritten` : ""}`;
    default: {
      const parts = Object.entries(d)
        .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${String(v)}`);
      return parts.join(" · ");
    }
  }
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; since?: string; action?: string; actor?: string; workspace?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const { tenant = "default" } = sp;
  const since = sp.since ?? "30d";
  const role = await viewerRole();
  const scope = await viewerScope();
  // No session (dev mode) is the owner, as everywhere.
  const allowed = role === null || (can(role, "audit:read") && scope === null);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { tenant: tenant !== "default" ? tenant : undefined, since, action: sp.action, actor: sp.actor, workspace: sp.workspace, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const tabs = settingsTabs(tenant, { team: Boolean(session), active: "audit" });
  const subtitle = "Who signed in, minted a key, invited someone, changed a secret, deployed — and when support looked.";

  if (!allowed) {
    return (
      <SettingsShell title="Settings" subtitle={subtitle} tabs={tabs}>
        <EmptyState icon={<ScrollText />} title="Owner and admins only" description="The audit log is for the account's owner and admins who can open every workspace. Ask the owner if you need it." />
      </SettingsShell>
    );
  }

  let error: string | null = null;
  let page: { entries: AuditEntry[]; next: string | null } = { entries: [], next: null };
  try {
    page = await queryAudit({
      tenant,
      since: parseWhen(since || null),
      action: sp.action || undefined,
      actor: sp.actor || undefined,
      workspace: sp.workspace || undefined,
      cursor: sp.cursor || undefined,
      limit: 50,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const workspaces = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map((w) => w.name);
  const csv = `/api/audit${qs({ format: "csv", cursor: undefined, tenant: undefined })}`;
  const filtered = Boolean(sp.action || sp.actor || sp.workspace || since !== "30d");
  const field = "grid min-w-0 gap-1.5 text-sm font-medium text-fg";

  return (
    <SettingsShell title="Settings" subtitle={subtitle} tabs={tabs}>
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-fg">Audit log</h2>
            <p className="text-sm text-fg-muted">Kept for the life of the account, newest first.</p>
          </div>
          <a href={csv} className={buttonVariants({ variant: "secondary" })} download>
            <Download aria-hidden />
            Download CSV
          </a>
        </div>

        <form method="get" className="rounded-lg border border-line bg-surface p-4">
          {tenant !== "default" && <input type="hidden" name="tenant" value={tenant} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>
              When
              <Select name="since" defaultValue={since} className="w-full font-normal">
                {WINDOWS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className={field}>
              Action
              <Select name="action" defaultValue={sp.action ?? ""} className="w-full font-normal">
                <option value="">Everything</option>
                {FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>
            <label className={field}>
              Who
              <Input name="actor" defaultValue={sp.actor ?? ""} placeholder="email, key:label, support:…" className="font-normal" />
            </label>
            <label className={field}>
              Workspace
              <Select name="workspace" defaultValue={sp.workspace ?? ""} className="w-full font-normal">
                <option value="">Any</option>
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {filtered && (
              <Link href={`/dashboard/settings/audit${tenant !== "default" ? `?tenant=${tenant}` : ""}`} className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
            <Button type="submit" variant="primary">
              Filter
            </Button>
          </div>
        </form>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {page.entries.length === 0 ? (
            <EmptyState bare compact icon={<ScrollText />} title="Nothing matches" description="Widen the window or clear the filters." />
          ) : (
            <ul className="divide-y divide-line">
              {page.entries.map((e) => (
                <li key={e.id} className={e.action.startsWith("support.") ? "bg-warning-soft px-4 py-3 sm:px-5" : "px-4 py-3 sm:px-5"}>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <Chip tone={toneOf(e.action)}>
                      <span className="font-mono">{e.action}</span>
                    </Chip>
                    <span className="min-w-0 flex-1 text-sm text-fg [overflow-wrap:anywhere]">{describe(e) || <span className="text-fg-muted">{e.subject ?? ""}</span>}</span>
                  </div>
                  <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-xs text-fg-muted">
                    <Tooltip label={<WithEmails text={e.actor} />}>
                      <span className="max-w-full truncate font-mono">
                        <WithEmails text={e.actor} />
                      </span>
                    </Tooltip>
                    <span aria-hidden>·</span>
                    <LocalTime iso={e.at} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between px-1 text-sm text-fg-muted">
          <span>
            {page.entries.length} shown{sp.cursor ? " · older entries" : ""}
          </span>
          <div className="flex gap-2">
            {sp.cursor && (
              <Link href={`/dashboard/settings/audit${qs({ cursor: undefined })}`} className={buttonVariants({ variant: "ghost" })}>
                Newest
              </Link>
            )}
            {page.next && (
              <Link href={`/dashboard/settings/audit${qs({ cursor: page.next })}`} className={buttonVariants({ variant: "secondary" })}>
                Older →
              </Link>
            )}
          </div>
        </div>
        <p className="px-1 text-sm text-fg-muted">
          Also on the API (<code className="font-mono">GET /api/audit</code>) and the CLI (<code className="font-mono">foldrun audit --since 7d --csv</code>). Secrets are recorded by name — a value never reaches this log.
        </p>
      </section>
    </SettingsShell>
  );
}
