// Account-wide runs — every workspace your API key can see. The per-workspace
// view lives at /dashboard/<workspace>/runs and keeps the workspace nav.

import { RunSearch } from "@/components/run-search";
import { parseRunFilter, matchesRunFilter, isEmptyFilter } from "@/lib/runs-filter";
import { SEARCH_KEYS } from "@/components/run-views-model";
import { runCharges, runCharge } from "@/server/run-charges";
import { listAllRuns, runDisplayStatus } from "@/lib/store";
import { viewerScope } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { AutoRefresh } from "../run-button";
import { PageHeader } from "@/components/ui";
import {
  Pager,
  RunFilters,
  RunStats,
  RunsTable,
  whatRan,
  runSearchText,
  type RunRow,
  filterByWindow,
  pageOf,
} from "@/components/runs-table";
import { RunsSelection } from "@/components/runs-bulk";
import { ListSearch } from "@/components/list-search";
import { filterByQuery } from "@/components/list-search-model";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenant?: string;
    workspace?: string;
    flow?: string;
    status?: string;
    since?: string;
    page?: string;
    q?: string;
    tool?: string;
    tool_error?: string;
    agent?: string;
    model?: string;
    min_tokens?: string;
    min_secs?: string;
  }>;
}) {
  const {
    tenant = "default",
    workspace: workspaceFilter,
    flow: flowFilter,
    status: statusFilter,
    since,
    page: pageParam,
    q = "",
  } = await searchParams;

  const scope = await viewerScope();
  const all: RunRow[] = listAllRuns(tenant).filter((r) => scopeAllows(scope, r.workspace));
  const charges = await runCharges(tenant);

  // Choices come from the data, and each dimension's options are computed
  // from the runs the OTHER filters leave — so a chip is never offered that
  // would return an empty table.
  const workspaces = [...new Set(all.map((r) => r.workspace))].sort();
  const inWorkspace = workspaceFilter ? all.filter((r) => r.workspace === workspaceFilter) : all;
  const flows = [...new Set(inWorkspace.map((r) => whatRan(r.flow)))].sort();

  let runs = inWorkspace;
  if (flowFilter) runs = runs.filter((r) => whatRan(r.flow) === flowFilter);
  // Display status, not raw: a stopped run is `failed` on disk, and a filter
  // that disagrees with the badge in the row it filters is a bug people
  // report as "the filter is broken".
  if (statusFilter) runs = runs.filter((r) => runDisplayStatus(r) === statusFilter);
  runs = filterByQuery(filterByWindow(runs, since), q, runSearchText);
  // Search by what happened inside a run (FOL-72 step 9).
  const sp = await searchParams;
  const searchKept = Object.fromEntries(SEARCH_KEYS.map((k) => [k, (sp as Record<string, string | undefined>)[k] || undefined]));
  const { filter } = parseRunFilter({ get: (k: string) => (sp as Record<string, string | undefined>)[k] ?? null });
  if (!isEmptyFilter(filter)) runs = runs.filter((r) => matchesRunFilter(r as unknown as Parameters<typeof matchesRunFilter>[0], filter));

  const { rows, pages, page } = pageOf(runs, Number(pageParam) || 1);
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const current = { workspace: workspaceFilter, flow: flowFilter, status: statusFilter, since, q: q || undefined, ...searchKept };
  const filterQs = Object.entries(current)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <AutoRefresh active={runs.some((r) => r.status === "running" || r.status === "queued")} />
      <PageHeader title="All runs" subtitle="Every run across every workspace in this account." />

      <RunStats runs={runs} chargedUsd={runs.reduce((n, r) => n + runCharge(r, charges), 0)} />

      <ListSearch mode="url" value={q} placeholder="Search runs — id, flow, workspace, headline, error…" noun="runs" />
      {/* Keyed by the search, so a saved view, back and forward reset its
          fields to what the URL says (Codex review). */}
      <RunSearch key={JSON.stringify(searchKept)} tenant={tenant} />
      <RunFilters
        base="/dashboard/runs"
        current={current}
        workspaces={workspaces}
        flows={flows}
        tenantParam={tenantParam}
        total={runs.length}
      />

      <RunsSelection
        tenant={tenant}
        runs={rows.map((r) => ({ workspace: r.workspace, id: r.id, status: runDisplayStatus(r) }))}
      >
        <RunsTable
          runs={rows}
          money={Object.fromEntries(rows.map((r) => [r.id, { usd: runCharge(r, charges), charged: charges.usd.has(r.id) }]))}
          tenant={tenant}
          tenantParam={tenantParam}
          emptyDescription="Nothing matches these filters. Clear one, or start a run from a workspace page."
        />
      </RunsSelection>
      <Pager
        base={`/dashboard/runs${filterQs ? `?${filterQs}` : ""}`}
        page={page}
        pages={pages}
        tenantParam={tenantParam}
      />
    </main>
  );
}
