// Settings → Audit log: what people did in this account — sign-ins, keys,
// invites, secrets by name, deploys, plan changes, and support's visits —
// newest first, filtered, a page at a time, and as CSV for an auditor.
//
// The same reader as GET /api/audit, with the same gate: the owner and
// admins who can see the whole account.

import Link from "next/link";
import { PageHeader, Card, Badge, buttonClass, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { viewerRole, viewerScope } from "@/server/users";
import { can } from "@/platform/permissions";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces } from "@/lib/store";
import { queryAudit, parseWhen, type AuditEntry } from "@/server/audit";
import { WithEmails } from "@/components/email";

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

const variantOf = (action: string) =>
  action.startsWith("support.") ? "warning" : /refused|revoked|deleted|removed|disabled|close/.test(action) ? "error" : /created|enabled|joined|invited/.test(action) ? "success" : "default";

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
    case "secret.set":
    case "secret.deleted":
      return `${s("name")}${s("kind") ? ` (${s("kind")})` : ""}${s("workspace") ? ` in ${s("workspace")}` : " (account)"}`;
    case "secret.sites": {
      const sites = Array.isArray(d.sites) ? (d.sites as string[]) : [];
      return `${s("name")}${s("workspace") ? ` in ${s("workspace")}` : " (account)"} · ${sites.length ? `bound to ${sites.join(", ")}` : "unbound"}`;
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

  if (!allowed) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Audit log" subtitle="Who did what in this account." />
        <Card className="p-5">
          <p className="text-sm text-fg-tertiary">The audit log is for the account&apos;s owner and admins who can open every workspace. Ask the owner if you need it.</p>
        </Card>
      </main>
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Audit log"
        subtitle={
          <>
            Who signed in, minted a key, invited someone, changed a secret, deployed — and when support looked. Kept for the life of the account.{" "}
            <Link href={`/dashboard/settings${tenant !== "default" ? `?tenant=${tenant}` : ""}#security`} className="text-accent hover:underline">Settings</Link>
          </>
        }
      >
        <a href={csv} className={buttonClass("secondary")} download>
          Download CSV
        </a>
      </PageHeader>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {tenant !== "default" && <input type="hidden" name="tenant" value={tenant} />}
        <label className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>When</span>
          <select name="since" defaultValue={since} className={selectClass("w-40")}>
            {WINDOWS.map((w) => (
              <option key={w.v} value={w.v}>{w.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>Action</span>
          <select name="action" defaultValue={sp.action ?? ""} className={selectClass("w-40")}>
            <option value="">Everything</option>
            {FAMILIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>Who</span>
          <input name="actor" defaultValue={sp.actor ?? ""} placeholder="email, key:label, support:…" className={inputClass("w-56")} />
        </label>
        <label className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>Workspace</span>
          <select name="workspace" defaultValue={sp.workspace ?? ""} className={selectClass("w-40")}>
            <option value="">Any</option>
            {workspaces.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <button className={buttonClass("primary")}>Filter</button>
        {(sp.action || sp.actor || sp.workspace || since !== "30d") && (
          <Link href={`/dashboard/settings/audit${tenant !== "default" ? `?tenant=${tenant}` : ""}`} className={buttonClass("minimal")}>Clear</Link>
        )}
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <Card>
        {page.entries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-fg-muted">Nothing matches. Widen the window or clear the filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-faint text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">What</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {page.entries.map((e) => (
                  <tr key={e.id} className={e.action.startsWith("support.") ? "bg-amber-50/60" : undefined}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-fg-muted"><LocalTime iso={e.at} /></td>
                    <td className="max-w-56 truncate px-4 py-2 font-mono text-xs text-fg-secondary" title={e.actor}><WithEmails text={e.actor} /></td>
                    <td className="whitespace-nowrap px-4 py-2"><Badge variant={variantOf(e.action)}><span className="font-mono">{e.action}</span></Badge></td>
                    <td className="px-4 py-2 text-fg-secondary">{describe(e) || <span className="text-fg-subtle">{e.subject ?? ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
        <span>{page.entries.length} shown{sp.cursor ? " · older entries" : ""}</span>
        <div className="flex gap-2">
          {sp.cursor && <Link href={`/dashboard/settings/audit${qs({ cursor: undefined })}`} className={buttonClass("minimal")}>Newest</Link>}
          {page.next && <Link href={`/dashboard/settings/audit${qs({ cursor: page.next })}`} className={buttonClass("secondary")}>Older →</Link>}
        </div>
      </div>
      <p className="mt-4 text-xs text-fg-muted">
        Also on the API (<code className="font-mono">GET /api/audit</code>) and the CLI (<code className="font-mono">foldrun audit --since 7d --csv</code>). Secrets are recorded by name — a value never reaches this log.
      </p>
    </main>
  );
}
