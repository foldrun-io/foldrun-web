// Settings → Backups. What is backed up and how often, the snapshots this
// account is in, and the two ways back: restore a workspace's source from
// its own history (self-serve, here), or ask the operator to restore runs,
// state, storage or the database from a nightly archive.

import { $t } from "@/i18n";
import { backupPolicy, listBackups, listRestoreRequests } from "@/platform/backups";
import { databaseEnabled } from "@/platform/db";
import { listWorkspaces } from "@/lib/store";
import { headRevision, listRevisions } from "@/lib/history";
import { scopeAllows } from "@/platform/scope";
import { can } from "@/platform/permissions";
import { viewerRole, viewerScope } from "@/server/users";
import { SettingsShell, SettingsSection } from "@/components/settings-shell";
import { SettingsCard, EmptyState, Chip } from "@foldrun/ui/react/page";
import { Archive } from "lucide-react";
import { settingsTabs } from "../tabs";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { cookies } from "next/headers";
import { LocalTime } from "@/components/local-time";
import { Tooltip } from "@foldrun/ui/react/tooltip";
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
  const workspaces = await Promise.all(
    listWorkspaces(tenant)
      .filter((w) => scopeAllows(scope, w.name))
      .map(async (w) => {
        const latest = (await listRevisions(tenant, w.name, { limit: 1 }))[0] ?? null;
        return { name: w.name, history: Boolean(await headRevision(tenant, w.name)), lastChange: latest ? { at: latest.at, message: latest.message } : null };
      }),
  );
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const yes = (on: boolean, good: string, bad: string) => <Chip tone={on ? "good" : "warn"}>{on ? good : bad}</Chip>;

  return (
    <SettingsShell title={$t("settings.backups-page.settings")} subtitle={$t("settings.backups-page.howThisAccountIsBackedUp")} tabs={settingsTabs(tenant, { team: Boolean(session), active: "backups" })}>
      <SettingsSection id="covered">
        <SettingsCard
          title={$t("settings.backups-page.whatIsBackedUp")}
          description={$t("settings.backups-page.thePlatformBacksUpEveryAccount")}
          hint={$t("settings.backups-page.everyChangeToAWorkspaceS")}
        >
          <div className="space-y-5 text-sm text-fg-secondary">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-fg-muted">{$t("settings.backups-page.howOften")}</dt>
              <dd className="text-fg">{policy.schedule}</dd>
              <dt className="text-fg-muted">{$t("settings.backups-page.kept")}</dt>
              <dd className="text-fg">
                {$t("settings.backups-page.theLastOnTheServer", { keepLocal: String(policy.keepLocal) })}{policy.keepOffsiteDays ? $t("settings.backups-page.andDaysOffIt", { keepOffsiteDays: String(policy.keepOffsiteDays) }) : ""}
              </dd>
              <dt className="text-fg-muted">{$t("settings.backups-page.encrypted")}</dt>
              <dd className="text-fg">{policy.encrypted ? $t("settings.backups-page.yesEveryArchiveIsEncryptedOn") : "no"}</dd>
              <dt className="text-fg-muted">{$t("settings.backups-page.lastBackup")}</dt>
              <dd className="min-w-0">
                {last ? (
                  <span className="flex flex-wrap items-center gap-1.5 text-fg">
                    <LocalTime iso={last.at} />
                    {yes(last.verified, "verified", $t("settings.backups-page.notVerified"))}
                    {yes(Boolean(last.offsite), $t("settings.backups-page.copiedOffTheServer"), $t("settings.backups-page.onTheServerOnly"))}
                    {yes(last.encrypted, "encrypted", $t("settings.backups-page.notEncrypted"))}
                  </span>
                ) : (
                  <span className="text-fg-muted">{$t("settings.backups-page.noneRecordedForThisAccountYet2", { value: databaseEnabled() ? "" : $t("settings.backups-page.thisInstallHasNoBackupIndex") })}</span>
                )}
              </dd>
            </dl>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium text-fg">{$t("settings.backups-page.included")}</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {policy.covers.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 font-medium text-fg">{$t("settings.backups-page.notIncluded")}</p>
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

      <SettingsSection id="snapshots" title={$t("settings.backups-page.snapshots")} description={$t("settings.backups-page.eachNightlyArchiveThatHoldsThis")} action={backups.length ? <span className="text-sm tabular-nums text-fg-muted">{backups.length}</span> : undefined}>
        {backups.length === 0 ? (
          <EmptyState icon={<Archive />} title={$t("settings.backups-page.noSnapshotsYet")} description={$t("settings.backups-page.theyAppearHereAfterTheNext")} />
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
                      {b.kinds.map((k) => (k === "files" ? "files" : k === "database" ? "database" : b.encrypted ? "keys" : $t("settings.backups-page.keysSealed"))).join(", ")} · {b.offsite ? $t("settings.backups-page.server", { v0: String(b.offsite.toUpperCase()) }) : $t("settings.backups-page.serverOnly")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {yes(b.verified, "verified", $t("settings.backups-page.notVerified"))}
                    <Tooltip label={b.encrypted && b.recipient ? $t("settings.backups-page.sealedToKey", { recipient: String(b.recipient) }) : undefined}>
                      <span>{yes(b.encrypted, "encrypted", $t("settings.backups-page.notEncrypted"))}</span>
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
        title={$t("settings.backups-page.restoreAWorkspace")}
        description={$t("settings.backups-page.putAWorkspaceSAgentsFlows")}
      >
        <RestoreWorkspace workspaces={workspaces} canWrite={canWrite} />
      </SettingsSection>

      <SettingsSection
        id="request"
        title={$t("settings.backups-page.requestARestore")}
        description={$t("settings.backups-page.runsStateStorageFilesAndThe")}
      >
        <RequestRestore workspaces={workspaces.map((w) => w.name)} backups={backups.map((b) => ({ id: b.id, at: b.at }))} canAsk={canAsk} requests={requests} />
      </SettingsSection>
    </SettingsShell>
  );
}
