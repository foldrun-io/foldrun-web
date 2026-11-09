// Every change to this workspace, newest first — the log.
//
// The per-file History button answers "what did THIS file used to say". This
// page answers the question people ask first: what changed, when, by whom.
// A deploy is one row with its commit; a dashboard save is one row with the
// person who made it; the Observe page's eval table names these same ids.
// Every row since history moved off git (17 Oct 2026) holds the whole tree,
// so any of them can be rolled back to.

import fs from "node:fs";
import { Pager } from "@foldrun/ui/react/pager";
import { paginate, pageFrom, PAGE_SIZE } from "@foldrun/ui/react/paging";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { ensureBaseline, listRevisionsRestorable } from "@/lib/history";
import { History as HistoryIcon } from "lucide-react";
import { Page, PageHeader, EmptyState } from "@foldrun/ui/react/page";
import { SearchField } from "@foldrun/ui/react/list";
import { filterByQuery } from "@foldrun/ui/react/list-search-model";
import { HistoryList } from "./history-list";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; page?: string; q?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", page: pageParam, q = "" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  // A workspace no save has touched since history moved off git still has
  // a point to come back to: its tree as it stands now.
  await ensureBaseline(tenant, workspace);
  const revisions = await listRevisionsRestorable(tenant, workspace, { limit: 300 });
  const found = filterByQuery(revisions, q, (r) => [r.message, r.by, r.id, r.commit ?? "", ...r.paths].join(" "));
  const { rows, page, pages, total } = paginate(found, pageFrom(pageParam));
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  return (
    <Page>
      <PageHeader title="History" description="Every change to this workspace — saves, deploys, deletions — newest first. Open one to see its diff; roll back to any of them." />
      {revisions.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon />}
          title="No changes recorded yet"
          description="History starts with the next save. From then on every change is kept: what changed, from what, by whom."
        />
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField url value={q} placeholder="Search changes — message, path, author…" className="min-w-48 flex-1" />
            {q && (
              <span className="text-[13px] tabular-nums text-fg-muted">
                {found.length} {found.length === 1 ? "change" : "changes"}
              </span>
            )}
          </div>
          <HistoryList workspace={workspace} tenant={tenant} revisions={rows} page={page} />
        </div>
      )}
      <Pager base={`/dashboard/${workspace}/history${q ? `?q=${encodeURIComponent(q)}` : ""}`} page={page} pages={pages} total={total} pageSize={PAGE_SIZE} tenantParam={qs.replace("?", "&")} labels={["Newer", "Older"]} />
    </Page>
  );
}
