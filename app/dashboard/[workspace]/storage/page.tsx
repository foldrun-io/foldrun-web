// A desk's storage, as a file browser: upload at the top, then every file
// with its size, age, origin and sharing, download and share on the row,
// and a preview of the file as itself. The account's Storage page shows
// the same rows for every desk; both read server/storage-browser.ts.

import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { usedBytes, driverFor, fileStoreEnabled, listStorage } from "@/lib/storage";
import { nowMs } from "@/components/overview-model";
import { PageHeader } from "@/components/ui";
import { WorkspaceHeader } from "@/components/workspace-header";
import { UploadZone } from "./storage-tools";
import { FileBrowser } from "@/components/file-browser";
import { ShareList } from "@/components/share-list";
import { browserDesks } from "@/server/storage-browser";
import { listShares, shareUrl } from "@/platform/shares";
import { can } from "@/platform/permissions";
import { viewerRole } from "@/server/users";

export const dynamic = "force-dynamic";

export default async function WorkspaceFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  if (!fileStoreEnabled()) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <WorkspaceHeader workspace={workspace} qs={qs} />
        <PageHeader title="Storage" />
        <p className="rounded-lg border border-dashed border-line p-6 text-sm text-fg-muted">
          This instance runs a single workspace from a folder on disk, so there is no file store: <code className="font-mono text-xs">storage/</code> is a directory in that folder. Put something in it and the next run will read it.
        </p>
      </main>
    );
  }
  const { desks, canShare } = await browserDesks(tenant, [workspace]);
  const count = listStorage(tenant, workspace).length;
  // Every link this desk has (live, expired and revoked), newest decided in
  // the list itself. Read here so the list and the browser's per-file pills
  // can never disagree; revoking still goes through the API.
  const role = await viewerRole();
  const canRevoke = role === null || can(role, "workspace:write");
  const shares = (await listShares(tenant, workspace)).map((s) => ({
    token: s.token,
    path: s.path,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    // The public link from FOLDRUN_PUBLIC_URL, as the browser's pills and the
    // share API give it. shareUrl() throws with no public address; then the
    // row is listed and revocable but has nothing honest to copy.
    url: canShare ? shareUrl(s.token) : null,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />
      <PageHeader
        title="Storage"
        subtitle={<>What you upload and what {workspace}&apos;s runs produce. Agents read these at <code className="font-mono text-xs">workspace/storage/</code> and write new ones back there.</>}
      />
      <div className="mb-5 max-w-xl">
        <UploadZone
          workspace={workspace}
          tenant={tenant}
          maxMb={Number(process.env.FOLDRUN_STORAGE_MAX_MB ?? 512)}
          used={usedBytes(tenant, workspace)}
          quotaMb={Number(process.env.FOLDRUN_STORAGE_QUOTA_MB ?? 5120)}
          count={count}
          driver={driverFor(tenant, workspace).kind}
        />
      </div>
      <FileBrowser desks={desks} tenant={tenant} now={nowMs()} canShare={canShare} single />
      {(canShare || shares.length > 0) && (
        <ShareList rows={shares} workspace={workspace} tenant={tenant} now={nowMs()} canRevoke={canRevoke} />
      )}
    </main>
  );
}
