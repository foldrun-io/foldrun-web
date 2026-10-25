// Issues (FOL-54 step 3): what went wrong, grouped, and kept open until a
// person resolves it. Same list as GET /api/issues and `foldrun issues`.

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { viewerScope } from "@/server/users";
import { accountIssues, filterIssues, ISSUE_STATUSES, type IssueFilter } from "@/server/issues";
import { IssueActions } from "@/components/issue-actions";
import { LocalTime } from "@/components/local-time";
import { Email, WithEmails } from "@/components/email";
import { runHref } from "@/components/run-href";
import { fmtSpan } from "@/components/mission-model";
import { nowMs } from "@/components/overview-model";
import { issueDoctor, type Issue } from "@/lib/issues";

export const dynamic = "force-dynamic";

const TABS: { key: IssueFilter; label: string }[] = [
  { key: "active", label: "Open" },
  { key: "snoozed", label: "Snoozed" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const KIND: Record<Issue["kind"], { label: string; tone: string }> = {
  platform: { label: "platform", tone: "text-white bg-slate-800 ring-slate-800" },
  failed: { label: "failed", tone: "text-red-700 bg-red-50 ring-red-200" },
  blocked: { label: "blocked", tone: "text-orange-700 bg-orange-50 ring-orange-200" },
  bad: { label: "problem found", tone: "text-rose-700 bg-rose-50 ring-rose-200" },
  missed: { label: "missed schedule", tone: "text-amber-800 bg-amber-50 ring-amber-200" },
};

const ACTED: Record<string, string> = { acknowledge: "acknowledged", snooze: "snoozed", resolve: "resolved", reopen: "reopened" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ tenant?: string; status?: string; workspace?: string }> }) {
  const { tenant = "default", status: statusParam, workspace } = await searchParams;
  const status: IssueFilter = ISSUE_STATUSES.includes(statusParam as IssueFilter) ? (statusParam as IssueFilter) : "active";
  const now = nowMs();
  const scope = await viewerScope();
  const all = await accountIssues(tenant, scope, now);
  const issues = filterIssues(all, status, workspace);
  const count = (s: IssueFilter) => filterIssues(all, s, workspace).length;
  const q = (s: IssueFilter) => {
    const p = new URLSearchParams();
    if (s !== "active") p.set("status", s);
    if (workspace) p.set("workspace", workspace);
    if (tenant !== "default") p.set("tenant", tenant);
    const str = p.toString();
    return `/dashboard/issues${str ? `?${str}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Issues"
        subtitle={`What went wrong, grouped, and kept open until someone resolves it — a later good run does not close one.${workspace ? ` Only ${workspace}.` : ""}`}
      />
      <nav className="mb-4 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={q(t.key)}
            className={`rounded-md px-3 py-1.5 ${t.key === status ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-sunken hover:text-fg"}`}
          >
            {t.label} <span className="tabular-nums text-fg-subtle">{count(t.key)}</span>
          </Link>
        ))}
        {workspace && (
          <Link href={`/dashboard/issues${tenant !== "default" ? `?tenant=${tenant}` : ""}`} className="ml-auto rounded-md px-3 py-1.5 text-fg-muted hover:text-fg">
            Every workspace →
          </Link>
        )}
      </nav>

      {issues.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          {status === "active" ? "No open issues. Anything that fails, ends BLOCKED or finds a problem shows up here until someone resolves it." : "None."}
        </p>
      ) : (
        <ul className="space-y-3">
          {issues.map((i) => (
            <li key={i.id} id={i.id} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start gap-2">
                <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${KIND[i.kind].tone}`}>{KIND[i.kind].label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {i.what}
                    {i.agent && <span className="font-normal text-fg-muted"> · at {i.agent}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1">
                    {i.workspaces.map((w) => (
                      <span key={w} className="rounded bg-muted px-1.5 text-[10px] text-fg-muted">{w}</span>
                    ))}
                    {i.status !== "open" && (
                      <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-fg">
                        {i.status}
                        {i.snoozedUntil ? " until " : ""}
                        {i.snoozedUntil && <LocalTime iso={i.snoozedUntil} />}
                        {i.snoozedFor ? ` for ${i.snoozedFor} more` : ""}
                        {i.resolved?.by.startsWith("auto:") ? " (auto: a later run went fine)" : ""}
                      </span>
                    )}
                    {i.regressed && (
                      <span className="rounded bg-danger-soft px-1.5 text-[10px] font-medium text-danger" title="It was resolved and came back">
                        regressed{i.sinceRevision ? ` since ${i.sinceRevision.slice(0, 7)}` : ""}
                      </span>
                    )}
                  </p>
                </div>
                <IssueActions id={i.id} status={i.status} tenant={tenant} platform={i.kind === "platform"} accountWide={scope === null} doctor={issueDoctor(i)} />
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-fg-tertiary"><WithEmails text={i.reason} /></p>
              <p className="mt-1 text-xs text-fg"><span className="text-fg-muted">What to do:</span> {i.action}</p>
              <p className="mt-2 text-[11px] text-fg-muted">
                {i.count} time{i.count === 1 ? "" : "s"} · first <LocalTime iso={i.firstSeen} /> · latest {fmtSpan(Math.max(0, now - Date.parse(i.lastSeen)))} ago
                {i.recoveredAt && <span className="text-emerald-700"> · fine since {fmtSpan(Math.max(0, now - Date.parse(i.recoveredAt)))} ago</span>}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
                {i.runs.slice(0, 6).map((r) =>
                  r.missed ? (
                    <span key={r.id} className="text-fg-muted">due <LocalTime iso={r.at} /></span>
                  ) : (
                    <Link key={r.id} href={runHref(r.workspace, r.id, tenant)} className="font-mono text-fg-muted hover:text-fg hover:underline">{r.id}</Link>
                  ),
                )}
                {i.runs.length > 6 && <span className="text-fg-subtle">and {i.count - 6} more</span>}
              </p>
              {i.history.length > 0 && (
                <ol className="mt-2 space-y-0.5 border-t border-line-faint pt-2 text-[11px] text-fg-muted">
                  {[...i.history].reverse().slice(0, 8).map((e, k) => (
                    <li key={k}>
                      <LocalTime iso={e.at} /> — {ACTED[e.action] ?? e.action} by <Email value={e.by} />
                      {e.until && <> until <LocalTime iso={e.until} /></>}
                      {e.note && <span className="text-fg-tertiary"> · <WithEmails text={e.note} /></span>}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
