// The overview's building blocks, shared by the account home and each
// workspace's page so both read the same way, top to bottom:
//
//   status line   — the numbers, one line, each a link
//   Needs you     — what is broken or waiting, and whether it is the
//                   platform's fault or the desk's (only when there is any)
//   Now & next    — what is running, what fires next (only when there is any)
//
// then the page's own list (desks, or flows and agents). Each fact has one
// home: this replaced an Alerts card that repeated Needs attention, a Recent
// runs list that repeated the heartbeat, and an Up next card that repeated
// the empty Running panel's "Next:" line.

import Link from "next/link";
import { OUTCOME } from "@/components/outcome-model";
import { runHref } from "@/components/run-href";
import { fmtSpan, type AttentionItem, type Heartbeat, type NowItem } from "@/components/mission-model";
import { type Alert } from "@/components/overview-model";
import { creditsShort } from "@/components/money";
import { IssueActions } from "@/components/issue-actions";
import { issueDoctor } from "@/lib/issues";
import { WithEmails } from "@/components/email";
import { fmtIn } from "@/components/workspace-overview-model";
import { LocalTime } from "@/components/local-time";

const KIND: Record<AttentionItem["kind"], { label: string; tone: string; bar: string }> = {
  platform: { label: "platform", tone: "text-white bg-slate-800 ring-slate-800", bar: "bg-slate-800" },
  waiting: { label: "needs you", tone: "text-violet-700 bg-violet-50 ring-violet-200", bar: "bg-violet-500" },
  stuck: { label: "stuck", tone: "text-amber-800 bg-amber-50 ring-amber-200", bar: "bg-amber-500" },
  failed: { label: "failed", tone: "text-red-700 bg-red-50 ring-red-200", bar: "bg-red-600" },
  bad: { label: "bad", tone: "text-rose-700 bg-rose-50 ring-rose-200", bar: "bg-rose-500" },
  blocked: { label: "blocked", tone: "text-orange-700 bg-orange-50 ring-orange-200", bar: "bg-orange-500" },
  missed: { label: "missed", tone: "text-amber-800 bg-amber-50 ring-amber-200", bar: "bg-amber-500" },
};

export function Panel({ title, count, action, children, className = "" }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      <header className="flex items-center gap-2 border-b border-line-faint px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-fg-tertiary">{count}</span>}
        <span className="ml-auto">{action}</span>
      </header>
      {children}
    </section>
  );
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

/** The numbers, on one line. Replaced the Usage card, the wallet button,
 *  the Alerts card's all-clear and the Running panel's "Next:" line. */
export function StatusStrip({ facts, now }: { facts: StatusFacts; now: number }) {
  const f = facts;
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 hover:bg-muted";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm shadow-sm">
      <Link href={f.links.attention} className={item}>
        {f.attention === 0 ? (
          <><span className="text-emerald-600">✓</span><span className="text-fg-secondary">All clear</span></>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="font-semibold tabular-nums text-fg">{f.attention}</span>
            <span className="text-fg-tertiary">need{f.attention === 1 ? "s" : ""} attention</span>
            {f.platform > 0 && <span className="rounded bg-slate-800 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white">{f.platform} platform</span>}
          </>
        )}
      </Link>
      <span className="text-gray-200">·</span>
      <Link href={f.links.running} className={item}>
        <span className={`h-2 w-2 rounded-full ${f.running ? "animate-pulse bg-sky-500" : "bg-gray-300"}`} />
        <span className="font-semibold tabular-nums text-fg">{f.running}</span>
        <span className="text-fg-tertiary">running</span>
      </Link>
      <span className="text-gray-200">·</span>
      <Link href={f.links.next} className={item} title={f.next ? f.next.at : undefined}>
        <span className="text-fg-muted">next</span>
        {f.next ? (
          <>
            <span className="font-medium text-fg">{f.next.flow}</span>
            {f.next.workspace && <span className="text-fg-subtle">{f.next.workspace}</span>}
            <span className="tabular-nums text-fg-tertiary">{fmtIn(Math.max(0, Date.parse(f.next.at) - now))}</span>
          </>
        ) : (
          <span className="text-fg-subtle">nothing scheduled</span>
        )}
      </Link>
      <span className="ml-auto" />
      <Link href={f.links.spend} className={item}>
        {/* Charged, in credits (FOL-54): the ledger's figure, list price for
            runs not settled yet — what the account pays, not token cost. */}
        <span className="tabular-nums text-fg">{creditsShort(f.spendDayUsd)}</span>
        <span className="text-fg-muted">today</span>
        <span className="text-gray-300">/</span>
        <span className="tabular-nums text-fg">{creditsShort(f.spend7dUsd)}</span>
        <span className="text-fg-muted">7d</span>
      </Link>
      {f.budget && (
        <Link href={f.links.spend} className={`${item} ${f.budget.warn ? "font-medium text-amber-700" : "text-fg-tertiary"}`}>
          {f.budget.text}
        </Link>
      )}
      {f.balanceUsd !== undefined && f.balanceUsd !== null && (
        <Link href={f.links.balance ?? f.links.spend} className={`${item} font-medium ${f.balanceUsd <= 0 ? "text-red-700" : "text-fg"}`}>
          {creditsShort(f.balanceUsd)} <span className="font-normal text-fg-muted">left</span>
        </Link>
      )}
    </div>
  );
}

/** What is broken or waiting, worst first, with the money warnings last.
 *  Renders nothing when there is nothing: the status line says all clear. */
export function AttentionPanel({ items, alerts = [], tenant, showWorkspace = true, issuesHref, accountWide = true }: { items: AttentionItem[]; alerts?: Alert[]; tenant: string; showWorkspace?: boolean; issuesHref?: string; accountWide?: boolean }) {
  if (items.length === 0 && alerts.length === 0) return null;
  return (
    <Panel
      title="Needs attention"
      count={items.length + alerts.length}
      className="mb-4"
      action={issuesHref ? <Link href={issuesHref} className="text-[11px] font-medium text-fg-muted hover:text-fg">All issues →</Link> : undefined}
    >
      <ul id="attention" className="max-h-[26rem] divide-y divide-line-faint overflow-auto">
        {items.map((a) => {
          const k = KIND[a.kind];
          return (
            <li key={a.issue?.id ?? `${a.kind}/${a.workspace}/${a.what}`} className="relative flex items-start gap-2 hover:bg-sunken">
              <Link href={a.run ? runHref(a.run.workspace, a.run.id, tenant) : `${a.href ?? "/dashboard"}${tenant !== "default" ? `${(a.href ?? "").includes("?") ? "&" : "?"}tenant=${tenant}` : ""}`} className="group relative flex min-w-0 flex-1 gap-3 px-4 py-2.5">
                <span className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${k.bar}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${k.tone}`}>{k.label}</span>
                    <span className="truncate font-medium text-fg group-hover:underline">{a.what}</span>
                    {a.kind !== "platform" && showWorkspace && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-fg-muted">{a.workspace}</span>}
                    {a.kind === "platform" ? (
                      <span className="shrink-0 text-[11px] text-fg-muted">
                        {a.issue ? `×${a.count} run${a.count === 1 ? "" : "s"}` : `${a.count} flow${a.count === 1 ? "" : "s"}`}{a.desks && a.desks.length > 1 ? ` on ${a.desks.length} desks` : ""}
                      </span>
                    ) : a.issue ? (
                      a.count > 1 && <span className="shrink-0 text-[11px] text-fg-muted" title={`first ${a.issue.firstSeen}`}>×{a.count} since {fmtSpan(a.sinceMs ?? 0)} ago</span>
                    ) : (
                      a.count > 1 && <span className="shrink-0 text-[11px] text-fg-muted">×{a.count} today</span>
                    )}
                    {a.issue?.regressed && (
                      <span className="shrink-0 rounded bg-danger-soft px-1.5 text-[10px] font-medium text-danger" title="It was resolved and came back">
                        regressed{a.issue.sinceRevision ? ` since ${a.issue.sinceRevision.slice(0, 7)}` : ""}
                      </span>
                    )}
                    {a.issue?.status === "acknowledged" && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-fg-muted" title={`by ${a.issue.acknowledged?.by ?? "someone"}`}>acknowledged</span>}
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-subtle">{fmtSpan(a.ageMs)} ago</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-fg-tertiary"><WithEmails text={a.reason} /></p>
                  {a.fineMs != null && (
                    <p className="mt-0.5 text-[11px] text-emerald-700">fine since {fmtSpan(a.fineMs)} ago — resolve it if it is fixed</p>
                  )}
                  {a.kind === "platform" && a.desks && showWorkspace && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {a.desks.map((d) => <span key={d} className="rounded bg-muted px-1.5 text-[10px] text-fg-muted">{d}</span>)}
                    </p>
                  )}
                </div>
              </Link>
              {a.issue && (
                <div className="py-2.5 pr-4">
                  <IssueActions id={a.issue.id} status={a.issue.status} tenant={tenant} platform={a.issue.kind === "platform"} accountWide={accountWide} doctor={issueDoctor(a.issue)} />
                </div>
              )}
            </li>
          );
        })}
        {alerts.map((a) => (
          <li key={a.text}>
            <Link href={a.href} className="group relative flex items-center gap-3 px-4 py-2.5 hover:bg-sunken">
              <span className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${a.level === "error" ? "bg-red-600" : "bg-amber-500"}`} />
              <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${a.level === "error" ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>money</span>
              <span className="truncate text-sm text-gray-800 group-hover:underline">{a.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export interface NextFire {
  workspace: string;
  flow: string;
  at: string;
}

/** Running now, and the next few fires. Renders nothing when neither has
 *  anything: an empty "Nothing running" panel was a quarter of the screen. */
export function NowNext({ board, upcoming, now, tenant, showWorkspace = true, runsHref }: { board: NowItem[]; upcoming: NextFire[]; now: number; tenant: string; showWorkspace?: boolean; runsHref: string }) {
  if (board.length === 0 && upcoming.length === 0) return null;
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  // Nothing running: the status line already says 0, so Up next stands
  // alone rather than beside an empty box.
  return (
    <div className={`mb-4 grid grid-cols-1 items-start gap-4 ${board.length ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
      {board.length > 0 && (
        <Panel
          title="Running now"
          count={board.length}
          action={<Link href={runsHref} className="text-[11px] font-medium text-fg-muted hover:text-fg">All runs →</Link>}
        >
          <ul className="divide-y divide-line-faint">
            {board.slice(0, 8).map((r) => {
              const o = OUTCOME[r.outcome];
              const pct = r.steps ? Math.round((100 * r.done) / r.steps) : 0;
              return (
                <li key={`${r.workspace}/${r.id}`}>
                  <Link href={runHref(r.workspace, r.id, tenant)} className="group block px-4 py-2.5 hover:bg-sunken">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} />
                      <span className="truncate font-medium text-fg group-hover:underline">{r.what}</span>
                      {showWorkspace && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-fg-muted">{r.workspace}</span>}
                      {r.stuck && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">stuck?</span>}
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-muted">{fmtSpan(r.elapsedMs)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 pl-4">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${r.outcome === "waiting" ? "bg-violet-500" : "bg-sky-500"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                      <span className="w-44 shrink-0 truncate text-[11px] text-fg-muted">
                        {r.outcome === "waiting" ? (r.question ? "asking you a question" : "waiting for approval") : r.outcome === "queued" ? "queued" : r.active ? `step ${r.active.index}/${r.steps} · ${r.active.agent}` : `${r.done}/${r.steps} steps`}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <Panel title="Up next">
        {upcoming.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-fg-subtle">Nothing scheduled.</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {upcoming.slice(0, 5).map((u) => (
              <li key={`${u.workspace}/${u.flow}/${u.at}`}>
                <Link href={`/dashboard/${u.workspace}/flows?flow=${encodeURIComponent(u.flow)}${rest}`} className="group flex items-center gap-3 px-4 py-2 hover:bg-sunken">
                  <span className="w-16 shrink-0 text-xs font-medium tabular-nums text-fg">{fmtIn(Math.max(0, Date.parse(u.at) - now)).replace(/^in /, "")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium text-fg group-hover:underline">{u.flow}</span>
                    {showWorkspace && <span className="ml-1.5 text-fg-subtle">{u.workspace}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-fg-subtle"><LocalTime iso={u.at} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** A strip of a thing's last runs, oldest → newest, each a link to the run,
 *  left-padded to `n` so strips line up down a table. */
export function Cells({ beat, n, tenant }: { beat: Heartbeat; n: number; tenant: string }) {
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: Math.max(0, n - beat.cells.length) }).map((_, i) => <span key={`e${i}`} className="h-4 w-2 rounded-[2px] bg-muted" />)}
      {beat.cells.map((r) => (
        <Link
          key={r.id}
          href={runHref(r.workspace, r.id, tenant)}
          title={`${r.what} · ${OUTCOME[r.outcome].hint} · ${r.startedAt.slice(0, 16).replace("T", " ")} UTC${r.headline ? `\n${r.headline}` : ""}`}
          className={`h-4 w-2 rounded-[2px] ${OUTCOME[r.outcome].cell} transition-transform hover:scale-y-125 hover:ring-2 hover:ring-gray-900/20`}
        />
      ))}
    </div>
  );
}

/** The key to the cell colours, once per page. */
export function CellLegend() {
  return (
    <span className="hidden items-center gap-3 text-[10px] text-fg-muted md:flex">
      {(["good", "done", "quiet", "blocked", "bad", "failed", "running", "waiting"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${OUTCOME[k].cell.replace(" animate-pulse", "")}`} />{OUTCOME[k].label}</span>
      ))}
    </span>
  );
}
