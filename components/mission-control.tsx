// The overview's building blocks (UI refactor, Nov 2026, cloudhost's look),
// shared by the account home and each workspace's page so both read the
// same way:
//
//   StatusStrip     the numbers, as tiles (where a page wants them)
//   SpendPanel      money, as ring rows (cloudhost's Usage card)
//   AttentionPanel  what is broken or waiting, platform's fault or the desk's
//   NowNext         what is running and what fires next
//   outcomeRing     a run outcome as a card's status ring
//
// Each fact has one home: this replaced an Alerts card that repeated Needs
// attention, a Recent runs list that repeated the heartbeat, and an Up next
// card that repeated the empty Running panel's "Next:" line.

import Link from "next/link";
import { CheckCircle2, Clock3, Coins } from "lucide-react";
import { OUTCOME, type Outcome } from "@/components/outcome-model";
import { runHref } from "@/components/run-href";
import { fmtSpan, type AttentionItem, type Heartbeat, type NowItem } from "@/components/mission-model";
import { type Alert } from "@/components/overview-model";
import { creditsShort } from "@/components/money";
import { IssueActions } from "@/components/issue-actions";
import { issueDoctor } from "@/lib/issues";
import { WithEmails } from "@/components/email";
import { fmtIn } from "@/components/workspace-overview-model";
import { LocalTime } from "@/components/local-time";
import { Chip, EmptyState, Panel, PanelLink, Stat, StatGrid, UsageRows, type RingStatus, type Tone, type UsageRow } from "@/components/kit/page";
import { StatusDot } from "@/components/kit/status";
import { Tooltip } from "@/components/kit/tooltip";

const KIND: Record<AttentionItem["kind"], { label: string; tone: Tone }> = {
  platform: { label: "Platform", tone: "default" },
  waiting: { label: "Needs you", tone: "info" },
  stuck: { label: "Stuck", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  bad: { label: "Bad", tone: "bad" },
  blocked: { label: "Blocked", tone: "warn" },
  missed: { label: "Missed", tone: "warn" },
};

/** A run's outcome as a card's ring — the outcome's own word as its label,
 *  unchanged (the refactor keeps every outcome distinct). */
export function outcomeRing(o: Outcome | null | undefined): RingStatus {
  if (!o) return "idle";
  if (o === "running" || o === "queued") return "busy";
  if (o === "waiting") return "waiting";
  if (o === "failed" || o === "bad" || o === "blocked") return "error";
  if (o === "stopped") return "idle";
  return "live";
}

export interface StatusFacts {
  running: number;
  attention: number;
  /** Of `attention`, the platform's. */
  platform: number;
  next: { flow: string; at: string; workspace?: string } | null;
  spendDayUsd: number;
  spend7dUsd: number;
  /** "$12 of $50 this month" — a workspace's budget standing, when it has one. */
  budget?: { text: string; warn: boolean } | null;
  /** The account's credit, where billing is on. */
  balanceUsd?: number | null;
  links: { running: string; attention: string; next: string; spend: string; balance?: string };
}

/** The numbers as four tiles, each a door. */
export function StatusStrip({ facts, now }: { facts: StatusFacts; now: number }) {
  const f = facts;
  return (
    <StatGrid className="mb-8">
      <Stat
        href={f.links.attention}
        icon={f.attention === 0 ? <CheckCircle2 className="text-success" /> : <span className="size-2 rounded-full bg-red-500" />}
        label="Needs attention"
        value={f.attention === 0 ? "All clear" : f.attention}
        tone={f.attention ? "danger" : undefined}
        sub={f.platform > 0 ? `${f.platform} the platform's` : undefined}
      />
      <Stat href={f.links.running} icon={<span className={`size-2 rounded-full ${f.running ? "animate-pulse bg-sky-500" : "bg-gray-300"}`} />} label="Running now" value={f.running} />
      <Stat
        href={f.links.next}
        icon={<Clock3 />}
        label="Next run"
        value={f.next ? <span className="truncate text-lg">{f.next.flow}</span> : <span className="text-base font-normal text-fg-subtle">Nothing scheduled</span>}
        sub={f.next ? `${fmtIn(Math.max(0, Date.parse(f.next.at) - now))}${f.next.workspace ? ` · ${f.next.workspace}` : ""}` : undefined}
      />
      <Stat href={f.links.spend} icon={<Coins />} label="Spend today" value={creditsShort(f.spendDayUsd)} sub={`${creditsShort(f.spend7dUsd)} in 7 days`} />
    </StatGrid>
  );
}

/** Money as cloudhost's usage card: spend today and this week, a budget's
 *  standing, the balance. Charged, in credits (FOL-54): the ledger's figure,
 *  list price for runs not settled yet — what the account pays. */
export function SpendPanel({
  dayUsd,
  weekUsd,
  balanceUsd,
  budget,
  href,
  balanceHref,
}: {
  dayUsd: number;
  weekUsd: number;
  balanceUsd?: number | null;
  budget?: { spentUsd: number; limitUsd: number; label: string } | null;
  href: string;
  balanceHref?: string;
}) {
  const rows: UsageRow[] = [
    { key: "day", label: "Spent today", used: 0, limit: null, shown: creditsShort(dayUsd), href },
    { key: "week", label: "Spent in 7 days", used: 0, limit: null, shown: creditsShort(weekUsd), href },
    ...(budget ? [{ key: "budget", label: `Budget ${budget.label}`, used: budget.spentUsd, limit: budget.limitUsd, shown: `${creditsShort(budget.spentUsd)} / ${creditsShort(budget.limitUsd)}`, href }] : []),
    ...(balanceUsd !== undefined && balanceUsd !== null ? [{ key: "balance", label: "Balance", used: balanceUsd <= 0 ? 1 : 0, limit: 1, shown: creditsShort(balanceUsd), href: balanceHref ?? href }] : []),
  ];
  return (
    <Panel title="Usage" actions={<PanelLink href={href}>Usage</PanelLink>} flush>
      <UsageRows rows={rows} heading="This week" />
    </Panel>
  );
}

/** What is broken or waiting, worst first, with the money warnings last.
 *  "All clear" when there is nothing. */
export function AttentionPanel({ items, alerts = [], tenant, showWorkspace = true, issuesHref, accountWide = true, limit = 6 }: { items: AttentionItem[]; alerts?: Alert[]; tenant: string; showWorkspace?: boolean; issuesHref?: string; accountWide?: boolean; limit?: number }) {
  const total = items.length + alerts.length;
  return (
    <Panel title="Needs attention" count={total || undefined} actions={issuesHref ? <PanelLink href={issuesHref}>All issues</PanelLink> : undefined} flush>
      {total === 0 ? (
        <EmptyState bare icon={<CheckCircle2 className="text-success" />} title="All clear" description="Nothing failed, stuck or waiting for you." />
      ) : (
        <ul id="attention" className="divide-y divide-line">
          {items.slice(0, limit).map((a) => {
            const k = KIND[a.kind];
            const href = a.run ? runHref(a.run.workspace, a.run.id, tenant) : `${a.href ?? "/dashboard"}${tenant !== "default" ? `${(a.href ?? "").includes("?") ? "&" : "?"}tenant=${tenant}` : ""}`;
            return (
              <li key={a.issue?.id ?? `${a.kind}/${a.workspace}/${a.what}`} className="flex min-w-0 items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={href} className="block truncate text-sm font-medium text-fg hover:underline">
                    {a.what}
                  </Link>
                  <p className="line-clamp-2 text-sm text-fg-muted">
                    <WithEmails text={a.reason} />
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <Chip tone={k.tone} dot>
                      {k.label}
                    </Chip>
                    {a.kind !== "platform" && showWorkspace && <Chip>{a.workspace}</Chip>}
                    {a.kind === "platform" && a.desks && a.desks.length > 1 && <Chip>{a.desks.length} workspaces</Chip>}
                    {a.count > 1 && <Chip>×{a.count}</Chip>}
                    {a.issue?.regressed && <Chip tone="bad">regressed</Chip>}
                    {a.issue?.status === "acknowledged" && <Chip>acknowledged</Chip>}
                    <span className="text-xs text-fg-muted">{fmtSpan(a.ageMs)} ago</span>
                  </div>
                  {a.fineMs != null && <p className="text-xs text-success">Fine for {fmtSpan(a.fineMs)}: resolve it if it is fixed.</p>}
                </div>
                {a.issue && (
                  <div className="shrink-0 pt-0.5">
                    <IssueActions id={a.issue.id} status={a.issue.status} tenant={tenant} platform={a.issue.kind === "platform"} accountWide={accountWide} doctor={issueDoctor(a.issue)} compact />
                  </div>
                )}
              </li>
            );
          })}
          {alerts.map((a) => (
            <li key={a.text} className="flex min-w-0 items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <Link href={a.href} className="block text-sm font-medium text-fg hover:underline">
                  {a.text}
                </Link>
                <Chip tone={a.level === "error" ? "bad" : "warn"} dot>
                  Money
                </Chip>
              </div>
            </li>
          ))}
          {items.length > limit && issuesHref && (
            <li>
              <Link href={issuesHref} className="block px-5 py-2.5 text-center text-sm text-fg-muted hover:bg-sunken hover:text-fg">
                {items.length - limit} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

export interface NextFire {
  workspace: string;
  flow: string;
  at: string;
}

/** Running now (only when something runs) and the next fires. */
export function NowNext({ board, upcoming, now, tenant, showWorkspace = true, runsHref }: { board: NowItem[]; upcoming: NextFire[]; now: number; tenant: string; showWorkspace?: boolean; runsHref: string }) {
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  return (
    <>
      {board.length > 0 && (
        <Panel title="Running now" count={board.length} actions={<PanelLink href={runsHref}>All runs</PanelLink>} flush>
          <ul className="divide-y divide-line">
            {board.slice(0, 6).map((r) => {
              const pct = r.steps ? Math.round((100 * r.done) / r.steps) : 0;
              return (
                <li key={`${r.workspace}/${r.id}`}>
                  <Link href={runHref(r.workspace, r.id, tenant)} className="group block px-5 py-3 hover:bg-sunken">
                    <div className="flex items-center gap-2 text-sm">
                      <StatusDot outcome={r.outcome} label="" />
                      <span className="truncate font-medium text-fg group-hover:underline">{r.what}</span>
                      {showWorkspace && <span className="shrink-0 text-fg-muted">{r.workspace}</span>}
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">{fmtSpan(r.elapsedMs)}</span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${r.outcome === "waiting" ? "bg-violet-500" : "bg-sky-500"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
                    </div>
                    <p className="mt-1.5 truncate text-xs text-fg-muted">
                      {r.outcome === "waiting" ? (r.question ? "Asking you a question" : "Waiting for approval") : r.outcome === "queued" ? "Queued" : r.active ? `Step ${r.active.index} of ${r.steps} · ${r.active.agent}` : `${r.done} of ${r.steps} steps`}
                      {r.stuck && " · stuck?"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <Panel title="Up next" flush>
        {upcoming.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-fg-muted">Nothing scheduled.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.slice(0, 5).map((u) => (
              <li key={`${u.workspace}/${u.flow}/${u.at}`}>
                <Link href={`/dashboard/${u.workspace}/flows?flow=${encodeURIComponent(u.flow)}${rest}`} className="group flex items-center gap-3 px-5 py-3 hover:bg-sunken">
                  <Clock3 className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium text-fg group-hover:underline">{u.flow}</span>
                    {showWorkspace && <span className="ml-1.5 text-fg-muted">{u.workspace}</span>}
                  </span>
                  <Tooltip label={u.at}>
                    <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                      {fmtIn(Math.max(0, Date.parse(u.at) - now))}
                    </span>
                  </Tooltip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** A thing's last runs, oldest → newest, each a link to the run. */
export function Cells({ beat, n, tenant }: { beat: Heartbeat; n: number; tenant: string }) {
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: Math.max(0, n - beat.cells.length) }).map((_, i) => (
        <span key={`e${i}`} className="h-5 w-1.5 rounded-full bg-muted" />
      ))}
      {beat.cells.map((r) => {
        const tip = `${r.what} · ${OUTCOME[r.outcome].hint} · ${r.startedAt.slice(0, 16).replace("T", " ")} UTC${r.headline ? `\n${r.headline}` : ""}`;
        return (
          <Tooltip key={r.id} label={<span className="whitespace-pre-line">{tip}</span>}>
            <Link
              href={runHref(r.workspace, r.id, tenant)}
              aria-label={tip}
              className={`h-5 w-1.5 rounded-full ${OUTCOME[r.outcome].cell} transition-transform hover:scale-y-110`}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

/** The key to the cell colours, once per page. */
export function CellLegend() {
  return (
    <span className="hidden items-center gap-3 text-xs text-fg-muted lg:flex">
      {(["good", "done", "quiet", "blocked", "bad", "failed", "running", "waiting"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={`size-2 rounded-full ${OUTCOME[k].cell.replace(" animate-pulse", "")}`} />
          {OUTCOME[k].label}
        </span>
      ))}
    </span>
  );
}

export { LocalTime };
