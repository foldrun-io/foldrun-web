// The runs table, shared by the workspace-scoped runs page and the
// account-wide one. The only difference between them is whether the
// Workspace column earns its place — inside one workspace it doesn't.
//
// UI refactor (Nov 2026): cloudhost's ResourceList shape, drawn on the
// server because the list is filtered and paged there — tall rows with an
// icon box, what ran and one quiet line under it (why it failed, where a
// live run is, or what it concluded), then the outcome, when, how long and
// what it cost.

import { creditsShort } from "@/components/money";
import Link from "@foldrun/ui/react/link";
import { paginate, PAGE_SIZE } from "@foldrun/ui/react/paging";
import { runCost, runDisplayStatus, runDurationSecs, runFailure, runVerdict, type RunRecord } from "@/lib/store";
import { a2aRunLabel } from "@/components/a2a-model";
import { LocalTime } from "@/components/local-time";
import { DeleteButton } from "@/app/dashboard/manage";
import { FilterBar, type FilterDimension } from "@/components/filter-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/components/bulk-select";
import { runKey } from "@/components/run-key";
import { outcomeOf, tally } from "@/components/outcome-model";
import { Status } from "@/components/status";
import { EmptyState, SummaryCard, Tag, IconBox } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Bot, FlaskConical, Play, Workflow } from "lucide-react";

export type RunRow = RunRecord & { workspace: string };

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

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
  const bad = (n: number) => <span className={n > 0 ? "font-medium text-danger" : undefined}>{n}</span>;
  const items = [
    { label: "Total runs", value: runs.length },
    { label: "Completed", value: t.completedPct === null ? "—" : `${t.completedPct}%` },
    { label: "Failed", value: bad(failed) },
    ...(blocked > 0 ? [{ label: "Blocked", value: bad(blocked) }] : []),
    ...(t.bad > 0 ? [{ label: "Problem found", value: bad(t.bad) }] : []),
    { label: "Typical duration", value: typical === null ? "—" : `${typical.toFixed(1)}s` },
    chargedUsd !== undefined
      ? { label: "Charged", value: creditsShort(chargedUsd) }
      : { label: "Total spend", value: `$${runs.reduce((s, r) => s + runCost(r), 0).toFixed(4)}` },
    { label: "Running now", value: runs.filter((r) => r.status === "running").length },
  ];
  return <SummaryCard className="mb-6" items={items.map((it) => ({ label: it.label, value: <span className="tabular-nums">{it.value}</span> }))} />;
}

/** The kind of thing a run ran, as the icon in its row's box. */
function KindIcon({ flow }: { flow: string }) {
  if (flow.startsWith("adhoc:")) return <Bot aria-label="agent" />;
  if (flow.startsWith("eval:")) return <FlaskConical aria-label="eval" />;
  return <Workflow aria-label="flow" />;
}

const TH = "h-10 px-3 text-left align-middle text-[13px] font-medium whitespace-nowrap text-fg-muted";
const TD = "h-16 px-3 py-2 align-middle whitespace-nowrap text-fg-secondary";

export function RunsTable({
  runs,
  tenant,
  tenantParam,
  showWorkspace = true,
  emptyDescription,
  money,
  a2aLabels,
}: {
  runs: RunRow[];
  /** A2A key principal → its label (a2aKeyLabels): a run an outside agent
   *  started reads "A2A · <label>" beside its outcome. */
  a2aLabels?: Record<string, string>;
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
    return <EmptyState icon={<Play />} title="No runs match" description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-sunken">
          <tr className="border-b border-line">
            {/* Selection, when the page mounts a RunsSelection around this
                table; a viewer sees an empty column. */}
            <th className="w-10 pl-4 pr-0 align-middle">
              <SelectAllCheckbox label="Select every run on this page" />
            </th>
            <th className={TH}>Run</th>
            {showWorkspace && <th className={cn(TH, "max-lg:hidden")}>Workspace</th>}
            <th className={TH}>Status</th>
            <th className={cn(TH, "max-sm:hidden")}>Started</th>
            <th className={cn(TH, "max-md:hidden")}>Duration</th>
            <th className={cn(TH, "text-right max-md:hidden")}>{money ? "Credits" : "Cost"}</th>
            <th className="w-px px-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {runs.map((r) => {
            const dur = runDurationSecs(r);
            const failure = runFailure(r);
            const href = `/dashboard/${r.workspace}/runs/${r.id}${tenantParam.replace("&", "?")}`;
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
            const a2a = a2aRunLabel(r, a2aLabels);
            const done = r.steps.filter((s) => s.status === "completed").length;
            // The record's own encoding, spelled out: a flow run names its
            // flow, a direct agent run its agent, an eval its eval —
            // "adhoc:extractor" is the platform's spelling, not the reader's.
            const kind = r.flow.startsWith("adhoc:") ? "agent" : r.flow.startsWith("eval:") ? "eval" : "flow";
            return (
              // `relative` makes the row the containing block for the
              // stretched link — the whole row opens the run, not just its
              // name.
              <tr key={`${r.workspace}/${r.id}`} className="group relative border-b border-line transition-colors hover:bg-sunken">
                {/* Above the row's stretched link, like the delete cell — or
                    ticking the box opens the run. */}
                <td className="relative z-10 w-10 pl-4 pr-0 align-middle">
                  <RowCheckbox id={runKey(r)} label={`Select run ${r.id.slice(4)}`} />
                </td>
                <td className={cn(TD, "w-full max-w-0")}>
                  <span className="flex min-w-0 items-center gap-3">
                    <IconBox hint={kind}>
                      <KindIcon flow={r.flow} />
                    </IconBox>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <Link
                          href={href}
                          className="truncate font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus"
                        >
                          {whatRan(r.flow)}
                        </Link>
                        <span className="shrink-0 font-mono text-xs text-fg-subtle max-sm:hidden">{r.id.slice(4)}</span>
                      </span>
                      {/* One quiet line: the reason, where it is, or what it
                          found. "failed" with no cause makes every diagnosis
                          start by opening the run — the sentence was in the
                          record all along. */}
                      {failure ? (
                        <Tooltip
                          label={
                            <>
                              {`${failure.agent}: ${failure.message}${failure.fix ? ` — ${failure.fix}` : ""}`}
                              {failure.reason !== failure.message ? <><br />{failure.reason}</> : null}
                            </>
                          }
                        >
                          <span className="block truncate text-xs text-fg-muted">
                            {failure.agent}: {failure.message}
                          </span>
                        </Tooltip>
                      ) : active.length > 0 ? (
                        <span className={cn("block truncate text-xs", r.status === "awaiting-approval" ? "text-warning" : "text-info")}>
                          {active
                            .map(
                              ({ s, i }) =>
                                `Step ${i + 1} of ${r.steps.length} · ${s.agent} — ${s.status === "awaiting-approval" ? "awaiting approval" : "running"}`,
                            )
                            .join(" · ")}
                        </span>
                      ) : summary ? (
                        <Tooltip label={summary}>
                          <span className="block truncate text-xs text-fg-muted">
                            {summary}
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="block truncate text-xs text-fg-muted">
                          {kind} · {done} of {r.steps.length} step{r.steps.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                {showWorkspace && <td className={cn(TD, "max-lg:hidden")}>{r.workspace}</td>}
                <td className={TD}>
                  <span className="flex items-center gap-1.5">
                    {/* One word, the same one every overview cell and dot
                        uses: a run that completed and reported BLOCKED is
                        "blocked" here too, not "completed". */}
                    <Status outcome={outcomeOf(runDisplayStatus(r), r.status === "completed" ? runVerdict(r) : null)} />
                    {r.test && (
                      <Tag className="h-5" hint="A test run: every step ran, nothing outward happened, state/ and storage/ were left alone">test</Tag>
                    )}
                    {a2a && (
                      <Tooltip label="Started by an outside agent over A2A, with this A2A key">
                        <span>
                          <Tag className="h-5 max-w-40 truncate">{a2a}</Tag>
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className={cn(TD, "max-sm:hidden")}>
                  <LocalTime iso={r.startedAt} options={WHEN} className="tabular-nums" />
                </td>
                <td className={cn(TD, "max-md:hidden")}>
                  <span className="block tabular-nums">{dur === null ? "…" : `${dur.toFixed(1)}s`}</span>
                  <span className="block text-xs tabular-nums text-fg-muted">
                    {done}/{r.steps.length} steps
                  </span>
                </td>
                <td className={cn(TD, "text-right tabular-nums max-md:hidden")}>
                  {money?.[r.id] ? (
                    <Tooltip label={money[r.id].charged ? "Charged" : "Estimated: list price until the run is settled"}>
                      <span>
                        {money[r.id].charged ? "" : "~"}
                        {creditsShort(money[r.id].usd).replace(/ credits?$/, "")}
                      </span>
                    </Tooltip>
                  ) : (
                    `$${runCost(r).toFixed(4)}`
                  )}
                </td>
                {/* Above the row's stretched link, or the overlay swallows
                    the click and "delete" quietly opens the run instead. */}
                <td className="relative z-10 w-px px-3 text-right align-middle whitespace-nowrap">
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <DeleteButton
                      endpoint={`/api/workspaces/${r.workspace}/runs/${r.id}`}
                      tenant={tenant}
                      confirmText={`Delete run ${r.id.slice(4)}? Its record and outputs go; the ledger entry it was charged on stays.`}
                      action="workspace:manage"
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the runs search box matches a run on: its id, what ran, where, what
 *  it concluded, and why it failed — the columns, plus the two sentences. */
export function runSearchText(r: RunRow): string {
  const failure = runFailure(r);
  return [r.id, whatRan(r.flow), r.workspace, runDisplayStatus(r), runVerdict(r) ?? "", r.summary ?? "", failure ? `${failure.agent} ${failure.reason} ${failure.message}` : ""].join(" ");
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
 *  `pageOf` remains the runs pages' name for it; they draw the kit's Pager
 *  with the chronological labels a runs list reads by. */
export const RUNS_PAGE_SIZE = PAGE_SIZE;

export function pageOf(runs: RunRow[], page: number): { rows: RunRow[]; pages: number; page: number; total: number } {
  return paginate(runs, page);
}

/** What a run's `flow` field means to a reader — the same transformation the
 *  table's "What ran" column makes, so a chip and a row cannot disagree. */
export function whatRan(flow: string): string {
  return flow.startsWith("adhoc:") ? flow.slice(6) : flow.startsWith("eval:") ? flow.slice(5) : flow;
}

/** The statuses a run can show — display statuses, so the filter and the
 *  badge in the row agree (a stopped run is `failed` on disk). */
export const RUN_STATUSES = ["completed", "failed", "stopped", "running", "queued", "awaiting-approval"] as const;

const STATUS_LABEL: Record<(typeof RUN_STATUSES)[number], string> = {
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  running: "Running",
  queued: "Queued",
  "awaiting-approval": "Awaiting approval",
};

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
      ? [{ key: "workspace", label: "Workspace", kind: "select" as const, allLabel: "All workspaces", options: workspaces.map((value) => ({ value })), resets: ["flow"] }]
      : []),
    { key: "flow", label: "What ran", kind: "select" as const, allLabel: "Everything that ran", options: flows.map((value) => ({ value })) },
    { key: "status", label: "Status", kind: "chips" as const, allLabel: "Any status", options: RUN_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })) },
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
