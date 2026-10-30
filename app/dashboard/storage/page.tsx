// Account-wide storage: every desk's files, as a file browser. One card per
// desk, a row per file with its size, age, origin and sharing, and download
// and share on the row; click one and it previews as itself.
//
// Deliberately a view of the desks. Runs stay workspace-scoped — a run sees
// its own desk's storage and nothing else, which keeps one desk's agent out
// of another's uploads — so uploading happens on a desk's own page, a link
// away on each card. Genuinely shared assets belong in the account library.

import Link from "next/link";
import { listWorkspaces } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { viewerScope } from "@/server/users";
import { fileStoreEnabled } from "@/lib/storage";
import { nowMs } from "@/components/overview-model";
import { PageHeader } from "@/components/ui";
import { FileBrowser } from "@/components/file-browser";
import { browserDesks, dashboardShareReader } from "@/server/storage-browser";

export const dynamic = "force-dynamic";

export default async function AccountStoragePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant = "default" } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  if (!fileStoreEnabled()) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Storage" />
        <p className="rounded-lg border border-dashed border-line p-6 text-sm text-fg-muted">
          This instance runs a single workspace from a folder on disk, so there is no file store: <code className="font-mono text-xs">storage/</code> is a directory in that folder.
        </p>
      </main>
    );
  }

  const scope = await viewerScope();
  const names = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name)).map((w) => w.name);
  const { desks, canShare } = await browserDesks(tenant, names, await dashboardShareReader());
  // Desks with files first, busiest first; the empty ones at the end.
  desks.sort((a, b) => (b.files.length > 0 ? 1 : 0) - (a.files.length > 0 ? 1 : 0) || b.files.reduce((s, f) => s + f.size, 0) - a.files.reduce((s, f) => s + f.size, 0));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Storage"
        subtitle="Every file your desks keep — what you uploaded and what their runs produced. Open a desk, click a file to see it, share it with a link; upload to any desk, or drop files on its card."
      >
        <Link href={`/dashboard/library/files${qs}`} className="text-sm font-medium text-fg-muted hover:text-fg">Shared library →</Link>
      </PageHeader>
      <FileBrowser desks={desks.filter((d) => d.files.length > 0)} workspaces={names} tenant={tenant} now={nowMs()} canShare={canShare} />
    </main>
  );
}
