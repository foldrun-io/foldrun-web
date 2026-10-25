// The runs table, shared by the workspace-scoped runs page and the
// account-wide one. The only difference between them is whether the
// Workspace column earns its place — inside one workspace it doesn't.

import { creditsShort } from "@/components/money";
import Link from "next/link";
import { Pager as BasePager } from "@/components/pager";
import { paginate, PAGE_SIZE } from "@/components/paging";
import { Fragment } from "react";
import { runCost, runDisplayStatus, runDurationSecs, runFailure, runVerdict, type RunRecord } from "@/lib/store";
import { Card, EmptyScreen, StatCard, TestBadge } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { DeleteButton } from "@/app/dashboard/manage";
import { FilterBar, type FilterDimension } from "@/components/filter-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/components/bulk-select";
import { runKey } from "@/components/run-key";
import { OUTCOME, outcomeOf, tally, type Outcome } from "@/components/outcome-model";

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome];
  return <span title={o.hint} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${o.pill}`}>{o.label}</span>;
}

export type RunRow = RunRecord & { workspace: string };

/** `chargedUsd`: what these runs were charged (server/run-charges.ts), shown
 *  in credits; without it, the token cost they used, in dollars. */
export function RunStats({ runs, chargedUsd }: { runs: RunRow[]; chargedUsd?: number }) {
  // The one count every surface shows (core outcome.ts, FOL-54): "Completed"
  // is ran-to-the-end-without-failing over completed + failed (stopped runs
  // left out); what the runs FOUND — BLOCKED, BAD — is counted beside it,
  // never folded into it.
  const t = tally(runs.map((r) => outcomeOf(runDisplayStatus(r), runVerdict(r))));
  const { failed, blocked } = t;
  const durations = runs
    .map((r) => runDurationSecs(r))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  // Median, not mean: one run parked overnight at an approval gate would
  // otherwise report every run as taking hours.
  const typical = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
      <StatCard label="Total runs" value={runs.length} />
      <StatCard label="Completed" value={t.completedPct === null ? "—" : `${t.completedPct}%`} />
      <StatCard label="Failed" value={failed} tone={failed > 0 ? "error" : undefined} />
      {blocked > 0 && <StatCard label="Blocked" value={blocked} tone="error" />}
      {t.bad > 0 && <StatCard label="Problem found" value={t.bad} tone="error" />}
      <StatCard label="Typical duration" value={typical === null ? "—" : `${typical.toFixed(1)}s`} />
      {chargedUsd !== undefined ? (
        <StatCard label="Charged" value={creditsShort(chargedUsd)} />
      ) : (
        <StatCard label="Total spend" value={`$${runs.reduce((s, r) => s + runCost(r), 0).toFixed(4)}`} />
      )}
      <StatCard label="Running now" value={runs.filter((r) => r.status === "running").length} />
    </div>
  );
}

export function RunsTable({
  runs,
  tenant,
  tenantParam,
  showWorkspace = true,
  emptyDescription,
  money,
}: {
  runs: RunRow[];
  /** runId → what the run is charged, in USD, and whether the ledger has
   *  settled it (else it is the list price). Shown in credits; without it,
   *  the token cost in dollars. */
  money?: Record<string, { usd: number; charged: boolean }>;
  /** The account these runs belong to — the delete call needs it as a
   *  header, not as a query string, so it is passed rather than parsed
   *  back out of tenantParam. */
  tenant: string;
  tenantParam: string;
  showWorkspace?: boolean;
  emptyDescription: string;
}) {
  if (runs.length === 0) {
    return (
      <EmptyScreen
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        }
        title="No runs match"
        description={emptyDescription}
      />
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {/* Selection, when the page mounts a RunsSelection around this
                table; a viewer sees an empty column. */}
            <th className="w-8 pl-4 pr-1 py-3"><SelectAllCheckbox label="Select every run on this page" /></th>
            <th className="px-4 py-3">Run</th>
            {showWorkspace && <th className="px-4 py-3">Workspace</th>}
            <th className="px-4 py-3">What ran</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Steps</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3">{money ? "Credits" : "Cost"}</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-faint">
          {runs.map((r) => {
            const dur = runDurationSecs(r);
            const failure = runFailure(r);
            // Where a live run actually is — the list answers it without a
            // click, the same way it already answers "why did this fail".
            const active =
              r.status === "running" || r.status === "awaiting-approval"
                ? r.steps
                    .map((s, i) => ({ s, i }))
                    .filter(({ s }) => s.status === "running" || s.status === "awaiting-approval")
                : [];
            // What the run concluded, on the list. Shown only when there is
            // no failure and nothing live to report, so a row never carries
            // two competing explanations of itself.
            const summary = failure === null && active.length === 0 ? r.summary?.trim() || null : null;
            const hasDetail = failure !== null || active.length > 0 || summary !== null;
            return (
              <Fragment key={`${r.workspace}/${r.id}`}>
              {/* `relative` makes the row the containing block for the
                  stretched link below — the whole row opens the run, not
                  just the id. */}
              <tr className={`group relative transition-colors hover:bg-sunken ${hasDetail ? "[&>td]:border-b-0" : ""}`}>
                {/* Above the row's stretched link, like the delete cell — or
                    ticking the box opens the run. */}
                <td className="relative z-10 w-8 pl-4 pr-1 py-2.5">
                  <RowCheckbox id={runKey(r)} label={`Select run ${r.id.slice(4)}`} />
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/dashboard/${r.workspace}/runs/${r.id}${tenantParam.replace("&", "?")}`}
                    className="font-mono text-xs font-medium text-fg hover:underline after:absolute after:inset-0 after:content-['']"
                  >
                    {r.id.slice(4)}
                  </Link>
                </td>
                {showWorkspace && (
                  <td className="px-4 py-2.5 text-xs text-fg-tertiary">{r.workspace}</td>
                )}
                {/* The record's own encoding, spelled out: a flow run names
                    its flow, a direct agent run says which agent, an eval
                    says which eval — "adhoc:extractor" is the platform's
                    spelling, not the reader's. */}
                <td className="px-4 py-2.5 text-xs text-fg-tertiary">
                  {r.flow.startsWith("adhoc:") ? (
                    <><span className="text-fg-subtle">agent: </span>{r.flow.slice(6)}</>
                  ) : r.flow.startsWith("eval:") ? (
                    <><span className="text-fg-subtle">eval: </span>{r.flow.slice(5)}</>
                  ) : (
                    <><span className="text-fg-subtle">flow: </span>{r.flow}</>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1">
                    {/* One word, the same one every overview cell and dot
                        uses: a run that completed and reported BLOCKED is
                        orange "blocked" here too, not a green "completed". */}
                    <OutcomeBadge outcome={outcomeOf(runDisplayStatus(r), r.status === "completed" ? runVerdict(r) : null)} />
                    {r.test && <TestBadge />}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-fg-muted">
                  {r.steps.filter((s) => s.status === "completed").length}/{r.steps.length}
                </td>
                <td className="px-4 py-2.5 text-xs text-fg-muted">
                  {dur === null ? "…" : `${dur.toFixed(1)}s`}
                </td>
                <td className="px-4 py-2.5 text-xs text-fg-muted">
                  {money?.[r.id] ? (
                    <span title={money[r.id].charged ? "Charged" : "Estimated: list price until the run is settled"}>
                      {money[r.id].charged ? "" : "~"}
                      {creditsShort(money[r.id].usd).replace(/ credits?$/, "")}
                    </span>
                  ) : (
                    `$${runCost(r).toFixed(4)}`
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-fg-subtle">
                  <LocalTime iso={r.startedAt} />
                </td>
                {/* Above the row's stretched link, or the overlay swallows
                    the click and "delete" quietly opens the run instead. */}
                <td className="relative z-10 px-4 py-2.5 text-right">
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <DeleteButton
                      endpoint={`/api/workspaces/${r.workspace}/runs/${r.id}`}
                      tenant={tenant}
                      confirmText={`Delete run ${r.id.slice(4)}? Its record and outputs go; the ledger entry it was charged on stays.`}
                    />
                  </span>
                </td>
              </tr>
              {active.length > 0 && (
                <tr>
                  {/* One line, clipped at the card's edge. The link is taken out of
                      the table's flow on purpose: a colSpan cell with nowrap text
                      has no width to truncate against, so a long line used to
                      widen the whole table instead — every column stretched, a
                      horizontal scrollbar appeared, and scrolling to the date
                      column scrolled the text off to the left with it. */}
                  <td colSpan={showWorkspace ? 10 : 9} className="px-4 pb-2.5 pt-0">
                    <div className="relative h-[18px]">
                    <Link
                      href={`/dashboard/${r.workspace}/runs/${r.id}${tenantParam.replace("&", "?")}`}
                      className={`absolute inset-x-0 top-0 block truncate font-mono text-[11px] leading-relaxed ${
                        r.status === "awaiting-approval"
                          ? "text-amber-600 hover:text-amber-700"
                          : "text-blue-600/80 hover:text-blue-700"
                      }`}
                    >
                      {active
                        .map(
                          ({ s, i }) =>
                            `${r.status === "awaiting-approval" && s.status === "awaiting-approval" ? "⏸" : "▸"} step ${i + 1}/${r.steps.length} · ${s.agent} — ${
                              s.status === "awaiting-approval" ? "awaiting approval" : "running"
                            }`,
                        )
                        .join("   ")}
                    </Link>
                    </div>
                  </td>
                </tr>
              )}
              {/* The reason, on the list itself. "failed" with no cause makes
                  every diagnosis start by opening the run — the sentence was
                  in the record all along. */}
              {failure && (
                <tr>
                  <td colSpan={showWorkspace ? 10 : 9} className="px-4 pb-2.5 pt-0">
                    <div className="relative h-[18px]">
                    <Link
                      href={`/dashboard/${r.workspace}/runs/${r.id}${tenantParam.replace("&", "?")}`}
                      className="absolute inset-x-0 top-0 block truncate font-mono text-[11px] leading-relaxed text-red-600/90 hover:text-red-700"
                      title={`${failure.agent}: ${failure.reason}`}
                    >
                      ✗ {failure.agent}: {failure.reason}
                    </Link>
                    </div>
                  </td>
                </tr>
              )}
              {/* The outcome, on the list itself — the sibling of the failure
                  row above. A status says a run finished; this says what it
                  found, which is the thing a person actually came for. */}
              {summary && (
                <tr>
                  <td colSpan={showWorkspace ? 10 : 9} className="px-4 pb-2.5 pt-0">
                    <div className="relative h-[18px]">
                    <Link
                      href={`/dashboard/${r.workspace}/runs/${r.id}${tenantParam.replace("&", "?")}`}
                      className="absolute inset-x-0 top-0 block truncate text-[11px] leading-relaxed text-fg-muted hover:text-fg-secondary"
                      title={summary}
                    >
                      {summary}
                    </Link>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** What the runs search box matches a run on: its id, what ran, where, what
 *  it concluded, and why it failed — the columns, plus the two sentences. */
export function runSearchText(r: RunRow): string {
  const failure = runFailure(r);
  return [r.id, whatRan(r.flow), r.workspace, runDisplayStatus(r), runVerdict(r) ?? "", r.summary ?? "", failure ? `${failure.agent} ${failure.reason}` : ""].join(" ");
}

/** The windows people actually reach for. Buckets, not a date-picker: a
 *  runs list is answering "what happened recently", and four chips answer
 *  it faster than two calendars. */
export const DATE_WINDOWS: Record<string, { label: string; ms: number }> = {
  today: { label: "Today", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
};

export function filterByWindow(runs: RunRow[], since?: string): RunRow[] {
  const w = since ? DATE_WINDOWS[since] : undefined;
  if (!w) return runs;
  const cutoff = Date.now() - w.ms;
  return runs.filter((r) => new Date(r.startedAt).getTime() >= cutoff);
}

/** The runs list turns like every other list — see components/paging.ts.
 *  `pageOf` and this `Pager` remain as the runs pages' names for them, with
 *  the chronological labels a runs list reads by. */
export const RUNS_PAGE_SIZE = PAGE_SIZE;

export function pageOf(runs: RunRow[], page: number): { rows: RunRow[]; pages: number; page: number; total: number } {
  return paginate(runs, page);
}

export function Pager(props: { base: string; page: number; pages: number; total?: number; tenantParam: string }) {
  return <BasePager {...props} labels={["← Newer", "Older →"]} />;
}

/** What a run's `flow` field means to a reader — the same transformation the
 *  table's "What ran" column makes, so a chip and a row cannot disagree. */
export function whatRan(flow: string): string {
  return flow.startsWith("adhoc:") ? flow.slice(6) : flow.startsWith("eval:") ? flow.slice(5) : flow;
}

/** The statuses a run can show — display statuses, so the filter and the
 *  badge in the row agree (a stopped run is `failed` on disk). */
export const RUN_STATUSES = ["completed", "failed", "stopped", "running", "queued", "awaiting-approval"] as const;

/**
 * The runs list's filters, as dimensions for the shared FilterBar: workspace
 * and "what ran" are long lists and become selects; status and window are
 * short and stay visible as one segmented row each. Every control changes a
 * single URL param and carries the rest — a chip that navigated away and
 * dropped the other filters was the bug this replaced.
 */
export function RunFilters({
  base,
  current,
  workspaces,
  flows,
  tenantParam,
  total,
}: {
  /** The page's path, no query. */
  base: string;
  /** `q` is the free-text search; it is not a dimension here, but it rides
   *  along in every chip's link so picking a status keeps the search. */
  /** The filters in force — the search's too (tool, agent, …), so the chips
   *  and the pager keep them (Codex review). */
  current: Record<string, string | undefined>;
  /** Choices drawn from the runs themselves — never a hardcoded list, so a
   *  filter can only offer values that would return something. */
  workspaces?: string[];
  flows: string[];
  tenantParam: string;
  /** Rows the current filters leave, shown beside the controls. */
  total?: number;
}) {
  const dimensions: FilterDimension[] = [
    ...(workspaces
      ? [{ key: "workspace", label: "Workspace", options: workspaces.map((value) => ({ value })), resets: ["flow"] }]
      : []),
    { key: "flow", label: "What ran", options: flows.map((value) => ({ value })) },
    { key: "status", label: "Status", kind: "chips" as const, allLabel: "Any", options: RUN_STATUSES.map((value) => ({ value })) },
    {
      key: "since",
      label: "When",
      kind: "chips" as const,
      allLabel: "All time",
      options: Object.entries(DATE_WINDOWS).map(([value, w]) => ({ value, label: w.label })),
    },
  ];
  return <FilterBar base={base} current={current} dimensions={dimensions} tenantParam={tenantParam} total={total} noun="runs" />;
}
