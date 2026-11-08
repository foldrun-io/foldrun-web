// Issues (FOL-54 step 3): what went wrong, grouped, and kept open until a
// person resolves it. Same list as GET /api/issues and `foldrun issues`.

import Link from "@foldrun/ui/react/link";
import { AlertTriangle, Ban, CalendarX2, CheckCircle2, ServerCrash, XCircle, X } from "lucide-react";
import { Page, PageHeader, Chip, Tag, EmptyState, type Tone } from "@foldrun/ui/react/page";
import { Segmented } from "@foldrun/ui/react/segmented";
import { cn } from "@foldrun/ui/react/cn";
import { viewerScope } from "@/server/users";
import { accountIssues, filterIssues, ISSUE_STATUSES, type IssueFilter } from "@/server/issues";
import { IssueActions } from "@/components/issue-actions";
import { LocalTime } from "@/components/local-time";
import { Email, WithEmails } from "@/components/email";
import { runHref } from "@/components/run-href";
import { fmtSpan } from "@/components/mission-model";
import { nowMs } from "@/components/overview-model";
import { issueDoctor, type Issue } from "@/lib/issues";
import { Disclosure } from "@foldrun/ui/react/disclosure";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export const dynamic = "force-dynamic";

const TABS: { key: IssueFilter; label: string }[] = [
  { key: "active", label: "Open" },
  { key: "snoozed", label: "Snoozed" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const KIND: Record<Issue["kind"], { label: string; tone: Tone; icon: React.ReactNode; box: string }> = {
  platform: { label: "platform", tone: "info", icon: <ServerCrash />, box: "border-info-line bg-info-soft text-info" },
  failed: { label: "failed", tone: "bad", icon: <XCircle />, box: "border-danger-line bg-danger-soft text-danger" },
  blocked: { label: "blocked", tone: "warn", icon: <Ban />, box: "border-warning-line bg-warning-soft text-warning" },
  bad: { label: "problem found", tone: "bad", icon: <AlertTriangle />, box: "border-danger-line bg-danger-soft text-danger" },
  missed: { label: "missed schedule", tone: "warn", icon: <CalendarX2 />, box: "border-warning-line bg-warning-soft text-warning" },
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
    <Page>
      <PageHeader title="Issues" description="What went wrong, grouped, and kept open until someone resolves it. A later good run does not close one." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Status" value={status} items={TABS.map((t) => ({ key: t.key, label: t.label, href: q(t.key), count: count(t.key) }))} />
        {workspace && (
          <Tooltip label="Show every workspace">
            <Link
              href={`/dashboard/issues${tenant !== "default" ? `?tenant=${tenant}` : ""}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] text-fg-secondary transition-colors hover:border-line-strong hover:text-fg"
            >
              Only <span className="font-medium text-fg">{workspace}</span>
              <X className="size-3.5 text-fg-muted" aria-label="Every workspace" />
            </Link>
          </Tooltip>
        )}
      </div>

      {issues.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={
            status === "active"
              ? "No open issues"
              : status === "snoozed"
                ? "Nothing snoozed"
                : status === "resolved"
                  ? "Nothing resolved yet"
                  : "No issues yet"
          }
          description={
            status === "active"
              ? "Anything that fails, ends BLOCKED or finds a problem shows up here until someone resolves it."
              : status === "snoozed"
                ? "An issue you snooze for a day, or until it happens five more times, waits here and comes back on its own."
                : status === "resolved"
                  ? "Issues someone resolved stay here; one that happens again opens again."
                  : "Every failure, BLOCKED or BAD result appears here, grouped, until someone resolves it."
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {issues.map((i) => {
            const k = KIND[i.kind];
            return (
              <li key={i.id} id={i.id} className="scroll-mt-20 px-3 py-4 transition-colors hover:bg-sunken/50 sm:px-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4", k.box)} aria-hidden>
                    {k.icon}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-fg [overflow-wrap:anywhere]">
                      {i.what}
                      {i.agent && <span className="font-normal text-fg-muted"> · at {i.agent}</span>}
                    </p>
                    <p className="line-clamp-1 text-sm text-fg-muted [overflow-wrap:anywhere]">
                      <WithEmails text={i.reason} />
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Chip tone={k.tone}>{k.label}</Chip>
                      {i.workspaces.map((w) => (
                        <Tag key={w}>{w}</Tag>
                      ))}
                      {i.status !== "open" && (
                        <Chip>
                          {i.status}
                          {i.snoozedUntil ? " until " : ""}
                          {i.snoozedUntil && <LocalTime iso={i.snoozedUntil} />}
                          {i.snoozedFor ? ` for ${i.snoozedFor} more` : ""}
                          {i.resolved?.by.startsWith("auto:") ? " (auto: a later run went fine)" : ""}
                        </Chip>
                      )}
                      {i.regressed && (
                        <Tooltip label="It was resolved and came back">
                          <span>
                            <Chip tone="bad">regressed{i.sinceRevision ? ` since ${i.sinceRevision.slice(0, 7)}` : ""}</Chip>
                          </span>
                        </Tooltip>
                      )}
                      <span className="text-xs text-fg-muted">
                        {i.count} time{i.count === 1 ? "" : "s"} · latest {fmtSpan(Math.max(0, now - Date.parse(i.lastSeen)))} ago
                      </span>
                    </div>
                    <Disclosure className="pt-1" summaryClassName="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-fg-secondary hover:text-fg" summary="Details">
                      <div className="mt-2 space-y-2 rounded-md border border-line bg-sunken p-3 text-[13px]">
                        <p className="text-fg">
                          <span className="text-fg-muted">What to do:</span> {i.action}
                        </p>
                        <p className="text-fg-secondary [overflow-wrap:anywhere]">
                          <WithEmails text={i.reason} />
                        </p>
                        <p className="text-fg-muted">
                          First <LocalTime iso={i.firstSeen} />
                          {i.recoveredAt && <span className="text-success"> · fine since {fmtSpan(Math.max(0, now - Date.parse(i.recoveredAt)))} ago</span>}
                        </p>
                        <p className="flex flex-wrap gap-x-3 gap-y-1">
                          {i.runs.slice(0, 6).map((r) =>
                            r.missed ? (
                              <span key={r.id} className="text-fg-muted">
                                due <LocalTime iso={r.at} />
                              </span>
                            ) : (
                              <Link key={r.id} href={runHref(r.workspace, r.id, tenant)} className="font-mono text-xs text-fg-secondary hover:text-fg hover:underline">
                                {r.id}
                              </Link>
                            ),
                          )}
                          {i.runs.length > 6 && <span className="text-fg-subtle">and {i.count - 6} more</span>}
                        </p>
                        {i.history.length > 0 && (
                          <ol className="space-y-0.5 border-t border-line pt-2 text-xs text-fg-muted">
                            {[...i.history]
                              .reverse()
                              .slice(0, 8)
                              .map((e, n) => (
                                <li key={n}>
                                  <LocalTime iso={e.at} /> — {ACTED[e.action] ?? e.action} by <Email value={e.by} />
                                  {e.until && (
                                    <>
                                      {" "}
                                      until <LocalTime iso={e.until} />
                                    </>
                                  )}
                                  {e.note && (
                                    <span className="text-fg-tertiary">
                                      {" "}
                                      · <WithEmails text={e.note} />
                                    </span>
                                  )}
                                </li>
                              ))}
                          </ol>
                        )}
                      </div>
                    </Disclosure>
                  </div>
                  <IssueActions id={i.id} status={i.status} tenant={tenant} platform={i.kind === "platform"} accountWide={scope === null} doctor={issueDoctor(i)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
