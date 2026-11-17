// Settings → Audit log: what people did in this account — sign-ins, keys,
// invites, secrets by name, deploys, plan changes, and support's visits —
// newest first, filtered, a page at a time, and as CSV for an auditor.
//
// The same reader as GET /api/audit, with the same gate: the owner and
// admins who can see the whole account.

import { $el, $rich, $t } from "@/i18n";
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
export const metadata = { title: $t("settings.audit-page.auditLogSettings") };

const FAMILIES = ["login", "logout", "session", "password", "mfa", "email", "apikey", "member", "owner", "secret", "workspace", "support", "account", "plan", "billing"];
const WINDOWS = [
  { v: "24h", label: $t("settings.audit-page.last24Hours") },
  { v: "7d", label: $t("settings.audit-page.last7Days") },
  { v: "30d", label: $t("settings.audit-page.last30Days") },
  { v: "90d", label: $t("settings.audit-page.last90Days") },
  { v: "", label: $t("settings.audit-page.allTime") },
];

const toneOf = (action: string): Tone =>
  action.startsWith("support.") ? "warn" : /refused|revoked|deleted|removed|disabled|close/.test(action) ? "bad" : /created|enabled|joined|invited/.test(action) ? "good" : "default";

/** One line a person reads, from an entry's detail — never the raw JSON. */
function describe(e: AuditEntry): string {
  const d = e.detail ?? {};
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (e.action) {
    case "support.viewed":
      return $t("settings.audit-page.supportViewedYourAccountReadOnly", { v0: String(s("until").slice(11, 16)), v1: String(s("reason")) });
    case "support.ended":
      return $t("settings.audit-page.supportSViewEnded", { v0: String(s("reason")) });
    case "apikey.created":
      return `${s("label")} (${s("prefix")}…) · ${s("role") || "editor"}${s("expiresAt") ? $t("settings.audit-page.expires", { v0: String(s("expiresAt").slice(0, 10)) }) : $t("settings.audit-page.neverExpires")}${s("via") ? $t("settings.audit-page.via", { v0: String(s("via")) }) : ""}`;
    case "apikey.rotated":
      return $t("settings.audit-page.newReplacesWhichEndsUtc", { v0: String(s("label")), v1: String(s("prefix")), v2: String(s("replacesPrefix")), v3: String(s("oldEndsAt").slice(0, 16).replace("T", " ")) });
    case "apikey.revoked":
      return `${s("label")} (${s("prefix")}…)`;
    case "apikey.models": {
      const m = (d.models && typeof d.models === "object" ? d.models : {}) as Record<string, string>;
      const parts = Object.entries(m).map(([t, v]) => `${t} → ${v}`);
      return `${s("label")} (${s("prefix")}…): ${parts.length ? parts.join(", ") : $t("settings.audit-page.runsClaudeCodeSModelsAs")}`;
    }
    case "secret.set":
    case "secret.deleted":
      return $t("settings.audit-page.secretWhere", { name: s("name") ?? "", hasKind: s("kind") ? "yes" : "no", kind: s("kind") ?? "", inWorkspace: s("workspace") ? "yes" : "no", workspace: s("workspace") ?? "" });
    case "secret.sites": {
      const sites = Array.isArray(d.sites) ? (d.sites as string[]) : [];
      return $t("settings.audit-page.secretSites", { name: s("name") ?? "", inWorkspace: s("workspace") ? "yes" : "no", workspace: s("workspace") ?? "", bound: sites.length ? "yes" : "no", sites: sites.join(", ") });
    }
    case "secret.workspaces": {
      const list = Array.isArray(d.workspaces) ? (d.workspaces as string[]) : null;
      return $t("settings.audit-page.account", { v0: String(s("name")), v1: String(list === null ? $t("settings.audit-page.everyWorkspace") : list.length ? $t("settings.audit-page.onlyThese", { list: list.join(", ") }) : $t("settings.audit-page.noWorkspace")) });
    }
    case "workspace.deployed":
      return `${s("workspace")}${s("commit") ? ` @ ${s("commit").slice(0, 8)}` : ""} · +${d.added ?? 0} ~${d.updated ?? 0} −${d.removed ?? 0}`;
    case "workspace.exported":
      return $t("settings.audit-page.exported", { whole: s("kind") === "workspace" ? "yes" : "no", kind: s("kind") ?? "", name: s("name") ?? "", workspace: s("workspace") ?? "", files: String(d.files ?? 0) });
    case "workspace.imported":
      return $t("settings.audit-page.imported", { whole: s("kind") === "workspace" ? "yes" : "no", kind: s("kind") ?? "", name: s("name") ?? "", hasFrom: s("from") ? "yes" : "no", from: s("from") ?? "", workspace: s("workspace") ?? "", created: d.created ? "yes" : "no", written: String(d.written ?? 0), overwrote: d.overwritten ? "yes" : "no", overwritten: String(d.overwritten ?? 0) });
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
  const subtitle = $t("settings.audit-page.whoSignedInMintedAKey");

  if (!allowed) {
    return (
      <SettingsShell title={$t("settings.audit-page.settings")} subtitle={subtitle} tabs={tabs}>
        <EmptyState icon={<ScrollText />} title={$t("settings.audit-page.ownerAndAdminsOnly")} description={$t("settings.audit-page.theAuditLogIsForThe")} />
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
    <SettingsShell title={$t("settings.audit-page.settings")} subtitle={subtitle} tabs={tabs}>
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-fg">{$t("settings.audit-page.auditLog")}</h2>
            <p className="text-sm text-fg-muted">{$t("settings.audit-page.keptForTheLifeOfThe")}</p>
          </div>
          <a href={csv} className={buttonVariants({ variant: "secondary" })} download>
            <Download aria-hidden />
            {$t("settings.audit-page.downloadCsv")}
          </a>
        </div>

        <form method="get" className="rounded-lg border border-line bg-surface p-4">
          {tenant !== "default" && <input type="hidden" name="tenant" value={tenant} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>
              {$t("settings.audit-page.when")}
              <Select name="since" defaultValue={since} className="w-full font-normal">
                {WINDOWS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className={field}>
              {$t("settings.audit-page.action")}
              <Select name="action" defaultValue={sp.action ?? ""} className="w-full font-normal">
                <option value="">{$t("settings.audit-page.everything")}</option>
                {FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>
            <label className={field}>
              {$rich("settings.audit-page.who", { input: $el(<Input name="actor" defaultValue={sp.actor ?? ""} placeholder="email, key:label, support:…" className="font-normal" />) })}
            </label>
            <label className={field}>
              {$t("settings.audit-page.workspace")}
              <Select name="workspace" defaultValue={sp.workspace ?? ""} className="w-full font-normal">
                <option value="">{$t("settings.audit-page.any")}</option>
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
                {$t("settings.audit-page.clear")}
              </Link>
            )}
            <Button type="submit" variant="primary">
              {$t("settings.audit-page.filter")}
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
            <EmptyState bare compact icon={<ScrollText />} title={$t("settings.audit-page.nothingMatches")} description={$t("settings.audit-page.widenTheWindowOrClearThe")} />
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
            {$t("settings.audit-page.shown", { length: String(page.entries.length) })}{sp.cursor ? $t("settings.audit-page.olderEntries") : ""}
          </span>
          <div className="flex gap-2">
            {sp.cursor && (
              <Link href={`/dashboard/settings/audit${qs({ cursor: undefined })}`} className={buttonVariants({ variant: "ghost" })}>
                {$t("settings.audit-page.newest")}
              </Link>
            )}
            {page.next && (
              <Link href={`/dashboard/settings/audit${qs({ cursor: page.next })}`} className={buttonVariants({ variant: "secondary" })}>
                {$t("settings.audit-page.older")}
              </Link>
            )}
          </div>
        </div>
        <p className="px-1 text-sm text-fg-muted">
          {$rich("settings.audit-page.alsoOnTheApiGetApi", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </p>
      </section>
    </SettingsShell>
  );
}
