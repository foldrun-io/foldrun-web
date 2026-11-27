// Account-wide storage: every desk's files, as a file browser. One card per
// desk, a row per file with its size, age, origin and sharing, and download
// and share on the row; click one and it previews as itself.
//
// Deliberately a view of the desks. Runs stay workspace-scoped — a run sees
// its own desk's storage and nothing else, which keeps one desk's agent out
// of another's uploads — so uploading happens on a desk's own page, a link
// away on each card. Genuinely shared assets belong in the account library.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { listWorkspaces } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { viewerScope } from "@/server/users";
import { fileStoreEnabled } from "@/lib/storage";
import { nowMs } from "@/components/overview-model";
import { Page, PageHeader, EmptyState } from "@foldrun/ui/react/page";
import { buttonVariants } from "@foldrun/ui/react/button";
import { HardDrive, Library } from "lucide-react";
import { FileBrowser } from "@/components/file-browser";
import { browserDesks, dashboardShareReader } from "@/server/storage-browser";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

export default async function AccountStoragePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  await requestLocale();
  const { tenant = "default" } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  if (!fileStoreEnabled()) {
    return (
      <Page>
        <PageHeader title={$t("storage.page.storage")} />
        <EmptyState
          icon={<HardDrive />}
          title={$t("storage.page.noFileStoreOnThisInstance")}
          description={<>{$rich("storage.page.thisInstanceRunsASingleTerm", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
        />
      </Page>
    );
  }

  const scope = await viewerScope();
  const names = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map((w) => w.name);
  const { desks, canShare } = await browserDesks(tenant, names, await dashboardShareReader());
  // Desks with files first, busiest first; the empty ones at the end.
  desks.sort((a, b) => (b.files.length > 0 ? 1 : 0) - (a.files.length > 0 ? 1 : 0) || b.files.reduce((s, f) => s + f.size, 0) - a.files.reduce((s, f) => s + f.size, 0));

  return (
    <Page>
      <PageHeader
        title={$t("storage.page.storage")}
        description={$t("storage.page.everyFileYourDesksKeepWhat")}
        actions={
          <Link href={`/dashboard/library/files${qs}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
            <Library />{" "}{$t("storage.page.sharedLibrary")}
          </Link>
        }
      />
      <FileBrowser desks={desks.filter((d) => d.files.length > 0)} workspaces={names} tenant={tenant} now={nowMs()} canShare={canShare} />
    </Page>
  );
}
