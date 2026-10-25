// Settings → Backups. What is backed up and how often, the snapshots this
// account is in, and the two ways back: restore a workspace's source from
// its own history (self-serve, here), or ask the operator to restore runs,
// state, storage or the database from a nightly archive.

import Link from "next/link";
import { backupPolicy, listBackups, listRestoreRequests } from "@/platform/backups";
import { databaseEnabled } from "@/platform/db";
import { listWorkspaces } from "@/lib/store";
import { headRevision, listRevisions } from "@/lib/history";
import { scopeAllows } from "@/platform/scope";
import { can } from "@/platform/permissions";
import { viewerRole, viewerScope } from "@/server/users";
import { SettingsShell, SettingsSection } from "@/components/settings-shell";
import { Card, Badge } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { RestoreWorkspace, RequestRestore } from "./controls";

export const dynamic = "force-dynamic";

function size(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant = "default" } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const scope = await viewerScope();
  const role = await viewerRole();
  const canWrite = role === null || can(role, "workspace:write");
  const canAsk = (role === null || can(role, "workspace:manage")) && scope === null;
  const policy = backupPolicy();
  const backups = await listBackups(tenant);
  const requests = await listRestoreRequests(tenant);
  const last = backups[0] ?? null;
  const workspaces = listWorkspaces(tenant)
    .filter((w) => scopeAllows(scope, w.name))
    .map((w) => {
      const latest = listRevisions(tenant, w.name, { limit: 1 })[0] ?? null;
      return { name: w.name, history: Boolean(headRevision(tenant, w.name)), lastChange: latest ? { at: latest.at, message: latest.message } : null };
    });
  const nav = [
    { id: "covered", label: "What is backed up" },
    { id: "snapshots", label: "Snapshots" },
    { id: "restore", label: "Restore a workspace" },
    { id: "request", label: "Request a restore" },
  ];

  return (
    <SettingsShell
      nav={nav}
      title="Backups"
      subtitle={
        <>
          <Link href={`/dashboard/settings${qs}`} className="hover:underline">Settings</Link> · how this account is backed up, and how to get something back
        </>
      }
    >
      <SettingsSection id="covered" title="What is backed up" description="The platform backs up every account together, on a schedule. You do not need to switch anything on.">
        <Card className="space-y-3 p-4 text-sm text-fg-secondary">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-fg-muted">How often</dt>
            <dd>{policy.schedule}</dd>
            <dt className="text-fg-muted">Kept</dt>
            <dd>
              the last {policy.keepLocal} on the server{policy.keepOffsiteDays ? `, and ${policy.keepOffsiteDays} days off it` : ""}
            </dd>
            <dt className="text-fg-muted">Encrypted</dt>
            <dd>
              {policy.encrypted
                ? "yes — every archive is encrypted on the server before it is copied off it, to a key the server does not hold"
                : "no"}
            </dd>
            <dt className="text-fg-muted">Last backup</dt>
            <dd>
              {last ? (
                <>
                  <LocalTime iso={last.at} /> {last.verified ? <Badge variant="success">verified</Badge> : <Badge variant="warning">not verified</Badge>}{" "}
                  {last.offsite ? <Badge>copied off the server</Badge> : <Badge variant="warning">on the server only</Badge>}{" "}
                  {last.encrypted ? <Badge variant="success">encrypted</Badge> : <Badge variant="warning">not encrypted</Badge>}
                </>
              ) : (
                <span className="text-fg-muted">none recorded for this account yet{databaseEnabled() ? "" : " — this install has no backup index"}</span>
              )}
            </dd>
          </dl>
          <div>
            <p className="mb-1 font-medium text-fg">Included</p>
            <ul className="list-disc space-y-0.5 pl-5">{policy.covers.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-fg">Not included</p>
            <ul className="list-disc space-y-0.5 pl-5">{policy.excludes.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <p className="text-xs text-fg-muted">
            Separately from these backups, every change to a workspace&apos;s files is a commit in its own history — that is what you can restore yourself, below.
          </p>
        </Card>
      </SettingsSection>

      <SettingsSection id="snapshots" title="Snapshots" description="Each nightly archive that holds this account, newest first." wide>
        <Card className="overflow-x-auto">
          {backups.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">No snapshots recorded for this account yet. They appear here after the next nightly backup.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-faint text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Taken</th>
                  <th className="px-4 py-2 font-medium">Holds</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Checked</th>
                  <th className="px-4 py-2 font-medium">Where</th>
                  <th className="px-4 py-2 font-medium">Encrypted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-2"><LocalTime iso={b.at} /></td>
                    <td className="px-4 py-2 text-fg-tertiary">{b.kinds.map((k) => (k === "files" ? "files" : k === "database" ? "database" : b.encrypted ? "keys" : "keys (sealed)")).join(", ")}</td>
                    <td className="px-4 py-2 tabular-nums text-fg-tertiary">{size(b.bytes)}</td>
                    <td className="px-4 py-2">{b.verified ? <Badge variant="success">verified</Badge> : <Badge variant="warning">no</Badge>}</td>
                    <td className="px-4 py-2 text-fg-tertiary">{b.offsite ? `server + ${b.offsite.toUpperCase()}` : "server only"}</td>
                    <td className="px-4 py-2">
                      {b.encrypted ? (
                        <Badge variant="success" title={b.recipient ? `sealed to key ${b.recipient}` : undefined}>encrypted</Badge>
                      ) : (
                        <Badge variant="warning">no</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </SettingsSection>

      <SettingsSection
        id="restore"
        title="Restore a workspace"
        description="Put a workspace's agents, flows, knowledge and tools back as they were at a point in its history. Runs, state, storage and secrets are not touched, and the restore is itself one more change you can undo."
      >
        <RestoreWorkspace workspaces={workspaces} canWrite={canWrite} />
      </SettingsSection>

      <SettingsSection
        id="request"
        title="Request a restore"
        description="Runs, state, storage files and the account's records come back only from a nightly snapshot. That restore is done by the platform team: ask here and they are emailed."
      >
        <RequestRestore workspaces={workspaces.map((w) => w.name)} backups={backups.map((b) => ({ id: b.id, at: b.at }))} canAsk={canAsk} requests={requests} />
      </SettingsSection>
    </SettingsShell>
  );
}
