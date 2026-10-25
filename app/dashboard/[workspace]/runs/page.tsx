// Runs for one workspace. Previously "Runs" in the workspace menu pointed at
// the account-wide page with a ?workspace= filter — the rows were right, but
// the sidebar fell back to account-level nav and the switcher read "none
// selected". Scoped data deserves scoped chrome.

import { RunSearch } from "@/components/run-search";
import { parseRunFilter, matchesRunFilter, isEmptyFilter } from "@/lib/runs-filter";
import { SEARCH_KEYS } from "@/components/run-views-model";
import { runCharges, runCharge } from "@/server/run-charges";
import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace-header";
import fs from "node:fs";
import { notFound, redirect } from "next/navigation";
import { runHref } from "@/components/run-href";
import { workspaceDir, listRuns, runDisplayStatus } from "@/lib/store";
import { AutoRefresh } from "../../run-button";
import { PageHeader } from "@/components/ui";
import { Pager, RunFilters, RunStats, RunsTable, whatRan, filterByWindow, pageOf, runSearchText, type RunRow } from "@/components/runs-table";
import { ListSearch } from "@/components/list-search";
import { filterByQuery } from "@/components/list-search-model";
import { RunsSelection } from "@/components/runs-bulk";

export const dynamic = "force-dynamic";

export default async function WorkspaceRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; flow?: string; status?: string; run?: string; since?: string; page?: string; q?: string; tool?: string; tool_error?: string; agent?: string; model?: string; min_tokens?: string; min_secs?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", flow: flowFilter, status: statusFilter, run: selectedRunId, since, page: pageParam, q = "" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  // A run has its own page now; the old ?run= links (emails, bookmarks,
  // notifications) land there.
  if (selectedRunId) redirect(runHref(workspace, selectedRunId, tenant));

  const all: RunRow[] = listRuns(tenant, workspace).map((r) => ({ ...r, workspace }));
  const charges = await runCharges(tenant);
  const flows = [...new Set(all.map((r) => whatRan(r.flow)))].sort();
  let filtered = flowFilter ? all.filter((r) => whatRan(r.flow) === flowFilter) : all;
  // Display status, so the chip and the badge in the row agree — a stopped
  // run is `failed` on disk.
  if (statusFilter) filtered = filtered.filter((r) => runDisplayStatus(r) === statusFilter);
  // Free text last: an id, a flow, what the run concluded, why it failed.
  // Search by what happened inside a run (FOL-72 step 9).
  const sp = await searchParams;
  const searchKept = Object.fromEntries(SEARCH_KEYS.map((k) => [k, (sp as Record<string, string | undefined>)[k] || undefined]));
  // Every filter in force rides the pager, the search's too (Codex review).
  const pagerQs = new URLSearchParams(
    Object.entries({ flow: flowFilter, status: statusFilter, since, q: q || undefined, ...searchKept }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  ).toString();
  const { filter } = parseRunFilter({ get: (k: string) => (sp as Record<string, string | undefined>)[k] ?? null });
  const runs = filterByQuery(filterByWindow(filtered, since), q, runSearchText).filter((r) => isEmptyFilter(filter) || matchesRunFilter(r as unknown as Parameters<typeof matchesRunFilter>[0], filter));
  // Stats describe the filtered window; the table shows one page of it.
  const { rows, pages, page } = pageOf(runs, Number(pageParam) || 1);

  // The live panel lives here rather than on the overview: a run that stops for
  // approval is waiting on a person, and the page they go to for that is the
  // one listing runs. On the overview it was a third of the landing page for
  // something most visits never need, and the approve button was somewhere you
  // would only find by already knowing.
  const awaiting = all.filter((r) => r.status === "awaiting-approval");
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  // Widening the scope keeps the question. "Failed, last 7 days, flow
  // harvest" carried across to the account page used to arrive as an
  // unfiltered list of everything — the four filters thrown away at the one
  // moment they were the point. Same names on both pages, so this is a copy.
  const wider = (() => {
    const p = new URLSearchParams();
    if (tenant !== "default") p.set("tenant", tenant);
    if (flowFilter) p.set("flow", flowFilter);
    if (statusFilter) p.set("status", statusFilter);
    if (since) p.set("since", since);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  })();

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* The open run paints itself over its stream; the timer is for the
          other rows, whose badges are server-rendered. */}
      <AutoRefresh active={runs.some((r) => r.status === "running" || r.status === "queued")} />

      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Runs"
        subtitle={
          awaiting.length
            ? `${awaiting.length} run${awaiting.length === 1 ? "" : "s"} waiting for you to approve a step.`
            : `Every run in ${workspace}. Open one to watch it step by step.`
        }
      >
        <Link
          href={`/dashboard/runs${wider}`}
          className="text-sm font-medium text-fg-muted hover:text-fg"
        >
          All workspaces →
        </Link>
      </PageHeader>

      <RunStats runs={runs} chargedUsd={runs.reduce((n, r) => n + runCharge(r, charges), 0)} />
      {/* Two filter rows: what happened, and when. Each chip row carries the
          other's choice in its links, so picking a window keeps the status
          and vice versa — filters that reset each other teach people not to
          combine them. Paging resets on any filter change, which is why the
          page param only appears on the pager's own links. */}
      {/* Same bar as the account view — one workspace, so no workspace row. */}
      <ListSearch mode="url" value={q} placeholder="Search runs — id, flow, headline, error…" noun="runs" />
      {/* Keyed by the search, so a saved view, back and forward reset its
          fields to what the URL says (Codex review). */}
      <RunSearch key={JSON.stringify(searchKept)} tenant={tenant} />
      <RunFilters
        base={`/dashboard/${workspace}/runs`}
        current={{ flow: flowFilter, status: statusFilter, since, q: q || undefined, ...searchKept }}
        flows={flows}
        tenantParam={tenantParam}
        total={runs.length}
      />
      <RunsSelection
        tenant={tenant}
        runs={rows.map((r) => ({ workspace, id: r.id, status: runDisplayStatus(r) }))}
      >
        <RunsTable
          runs={rows}
          money={Object.fromEntries(rows.map((r) => [r.id, { usd: runCharge(r, charges), charged: charges.usd.has(r.id) }]))}
          tenant={tenant}
          tenantParam={tenantParam}
          showWorkspace={false}
          emptyDescription={`Nothing in ${workspace} matches. Run an agent or a flow to see it here.`}
        />
      </RunsSelection>
      <Pager
        base={`/dashboard/${workspace}/runs${pagerQs ? `?${pagerQs}` : ""}`}
        page={page}
        pages={pages}
        tenantParam={tenantParam}
      />

    </main>
  );
}
