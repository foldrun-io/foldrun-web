// Settings → Backups. What is backed up and how often, the snapshots this
// account is in, and the two ways back: restore a workspace's source from
// its own history (self-serve, here), or ask the operator to restore runs,
// state, storage or the database from a nightly archive.

import { backupPolicy, listBackups, listRestoreRequests } from "@/platform/backups";
import { databaseEnabled } from "@/platform/db";
import { listWorkspaces } from "@/lib/store";
import { headRevision, listRevisions } from "@/lib/history";
import { scopeAllows } from "@/platform/scope";
import { can } from "@/platform/permissions";
import { viewerRole, viewerScope } from "@/server/users";
import { SettingsShell, SettingsSection } from "@/components/settings-shell";
import { SettingsCard, EmptyState, Chip } from "@/components/kit/page";
import { Archive } from "lucide-react";
import { settingsTabs } from "../tabs";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { cookies } from "next/headers";
import { LocalTime } from "@/components/local-time";
import { Tooltip } from "@/components/kit/tooltip";
import { RestoreWorkspace, RequestRestore } from "./controls";

export const dynamic = "force-dynamic";

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant = "default" } = await searchParams;
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
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const yes = (on: boolean, good: string, bad: string) => <Chip tone={on ? "good" : "warn"}>{on ? good : bad}</Chip>;

  return (
    <SettingsShell title="Settings" subtitle="How this account is backed up, and how to get something back." tabs={settingsTabs(tenant, { team: Boolean(session), active: "backups" })}>
      <SettingsSection id="covered">
        <SettingsCard
          title="What is backed up"
          description="The platform backs up every account together, on a schedule. You do not need to switch anything on."
          hint="Every change to a workspace's files is also a commit in its own history — that is what you can restore yourself."
        >
          <div className="space-y-5 text-sm text-fg-secondary">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-fg-muted">How often</dt>
              <dd className="text-fg">{policy.schedule}</dd>
              <dt className="text-fg-muted">Kept</dt>
              <dd className="text-fg">
                the last {policy.keepLocal} on the server{policy.keepOffsiteDays ? `, and ${policy.keepOffsiteDays} days off it` : ""}
              </dd>
              <dt className="text-fg-muted">Encrypted</dt>
              <dd className="text-fg">{policy.encrypted ? "yes — every archive is encrypted on the server before it is copied off it, to a key the server does not hold" : "no"}</dd>
              <dt className="text-fg-muted">Last backup</dt>
              <dd className="min-w-0">
                {last ? (
                  <span className="flex flex-wrap items-center gap-1.5 text-fg">
                    <LocalTime iso={last.at} />
                    {yes(last.verified, "verified", "not verified")}
                    {yes(Boolean(last.offsite), "copied off the server", "on the server only")}
                    {yes(last.encrypted, "encrypted", "not encrypted")}
                  </span>
                ) : (
                  <span className="text-fg-muted">none recorded for this account yet{databaseEnabled() ? "" : " — this install has no backup index"}</span>
                )}
              </dd>
            </dl>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium text-fg">Included</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {policy.covers.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 font-medium text-fg">Not included</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {policy.excludes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="snapshots" title="Snapshots" description="Each nightly archive that holds this account, newest first." action={backups.length ? <span className="text-sm tabular-nums text-fg-muted">{backups.length}</span> : undefined}>
        {backups.length === 0 ? (
          <EmptyState icon={<Archive />} title="No snapshots yet" description="They appear here after the next nightly backup." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <ul className="divide-y divide-line">
              {backups.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">
                      <LocalTime iso={b.at} />
                    </p>
                    <p className="mt-0.5 text-sm text-fg-muted">
                      {b.kinds.map((k) => (k === "files" ? "files" : k === "database" ? "database" : b.encrypted ? "keys" : "keys (sealed)")).join(", ")} · {b.offsite ? `server + ${b.offsite.toUpperCase()}` : "server only"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {yes(b.verified, "verified", "not verified")}
                    <Tooltip label={b.encrypted && b.recipient ? `sealed to key ${b.recipient}` : undefined}>
                      <span>{yes(b.encrypted, "encrypted", "not encrypted")}</span>
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
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
