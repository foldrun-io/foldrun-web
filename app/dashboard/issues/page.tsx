// Issues (FOL-54 step 3): what went wrong, grouped, and kept open until a
// person resolves it. Same list as GET /v1/issues and `foldrun issues`.

import { ISSUE_STATUS_LABEL, labelOf } from "@/components/value-labels";
import { $el, $rich, $t } from "@/i18n";
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
  { key: "active", label: $t("issues.page.open") },
  { key: "snoozed", label: $t("issues.page.snoozed") },
  { key: "resolved", label: $t("issues.page.resolved") },
  { key: "all", label: $t("issues.page.all") },
];

const KIND: Record<Issue["kind"], { label: string; tone: Tone; icon: React.ReactNode; box: string }> = {
  platform: { label: "platform", tone: "info", icon: <ServerCrash />, box: "border-info-line bg-info-soft text-info" },
  failed: { label: "failed", tone: "bad", icon: <XCircle />, box: "border-danger-line bg-danger-soft text-danger" },
  blocked: { label: "blocked", tone: "warn", icon: <Ban />, box: "border-warning-line bg-warning-soft text-warning" },
  bad: { label: $t("issues.page.problemFound"), tone: "bad", icon: <AlertTriangle />, box: "border-danger-line bg-danger-soft text-danger" },
  missed: { label: $t("issues.page.missedSchedule"), tone: "warn", icon: <CalendarX2 />, box: "border-warning-line bg-warning-soft text-warning" },
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
      <PageHeader title={$t("issues.page.issues")} description={$t("issues.page.whatWentWrongGroupedAndKept")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label={$t("issues.page.status")} value={status} items={TABS.map((t) => ({ key: t.key, label: t.label, href: q(t.key), count: count(t.key) }))} />
        {workspace && (
          <Tooltip label={$t("issues.page.showEveryWorkspace")}>
            <Link
              href={`/dashboard/issues${tenant !== "default" ? `?tenant=${tenant}` : ""}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] text-fg-secondary transition-colors hover:border-line-strong hover:text-fg"
            >
              {$rich("issues.page.only", { workspace: workspace, span: (chunks) => <span className="font-medium text-fg">{chunks}</span> })}
              <X className="size-3.5 text-fg-muted" aria-label={$t("issues.page.everyWorkspace")} />
            </Link>
          </Tooltip>
        )}
      </div>

      {issues.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={
            status === "active"
              ? $t("issues.page.noOpenIssues")
              : status === "snoozed"
                ? $t("issues.page.nothingSnoozed")
                : status === "resolved"
                  ? $t("issues.page.nothingResolvedYet")
                  : $t("issues.page.noIssuesYet")
          }
          description={
            status === "active"
              ? $t("issues.page.anythingThatFailsEndsBlockedOr")
              : status === "snoozed"
                ? $t("issues.page.anIssueYouSnoozeForA")
                : status === "resolved"
                  ? $t("issues.page.issuesSomeoneResolvedStayHereOne")
                  : $t("issues.page.everyFailureBlockedOrBadResult")
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
                      {i.agent && <span className="font-normal text-fg-muted">{" "}{$t("issues.page.at", { agent: i.agent })}</span>}
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
                          {labelOf(ISSUE_STATUS_LABEL, i.status)}
                          {i.snoozedUntil ? $rich("issues.page.untilTime", { time: $el(<LocalTime iso={i.snoozedUntil} />) }) : null}
                          {i.snoozedFor ? $t("issues.page.forMore", { snoozedFor: String(i.snoozedFor) }) : ""}
                          {i.resolved?.by.startsWith("auto:") ? $t("issues.page.autoALaterRunWentFine") : ""}
                        </Chip>
                      )}
                      {i.regressed && (
                        <Tooltip label={$t("issues.page.itWasResolvedAndCameBack")}>
                          <span>
                            <Chip tone="bad">{$t("issues.page.regressed2", { part: i.sinceRevision ? $t("issues.page.sinceRevision", { rev: i.sinceRevision.slice(0, 7) }) : "" })}</Chip>
                          </span>
                        </Tooltip>
                      )}
                      <span className="text-xs text-fg-muted">
                        {$t("issues.page.timeLatestAgo", { count: i.count, fmtSpan: fmtSpan(Math.max(0, now - Date.parse(i.lastSeen))) })}
                      </span>
                    </div>
                    <Disclosure className="pt-1" summaryClassName="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-fg-secondary hover:text-fg" summary={$t("issues.page.details")}>
                      <div className="mt-2 space-y-2 rounded-md border border-line bg-sunken p-3 text-[13px]">
                        <p className="text-fg">
                          <span className="text-fg-muted">{$t("issues.page.whatToDo")}</span> {i.action}
                        </p>
                        <p className="text-fg-secondary [overflow-wrap:anywhere]">
                          <WithEmails text={i.reason} />
                        </p>
                        <p className="text-fg-muted">
                          {$rich("issues.page.first", { localTime: $el(<LocalTime iso={i.firstSeen} />) })}
                          {i.recoveredAt && <span className="text-success">{" "}{$t("issues.page.fineSinceAgo", { fmtSpan: fmtSpan(Math.max(0, now - Date.parse(i.recoveredAt))) })}</span>}
                        </p>
                        <p className="flex flex-wrap gap-x-3 gap-y-1">
                          {i.runs.slice(0, 6).map((r) =>
                            r.missed ? (
                              <span key={r.id} className="text-fg-muted">
                                {$rich("issues.page.due", { localTime: $el(<LocalTime iso={r.at} />) })}
                              </span>
                            ) : (
                              <Link key={r.id} href={runHref(r.workspace, r.id, tenant)} className="font-mono text-xs text-fg-secondary hover:text-fg hover:underline">
                                {r.id}
                              </Link>
                            ),
                          )}
                          {i.runs.length > 6 && <span className="text-fg-subtle">{$t("issues.page.andMore", { count: String(i.count - 6) })}</span>}
                        </p>
                        {i.history.length > 0 && (
                          <ol className="space-y-0.5 border-t border-line pt-2 text-xs text-fg-muted">
                            {[...i.history]
                              .reverse()
                              .slice(0, 8)
                              .map((e, n) => (
                                <li key={n}>
                                  {$rich("issues.page.by", { localTime: $el(<LocalTime iso={e.at} />), action: ACTED[e.action] ?? e.action, email: $el(<Email value={e.by} />) })}
                                  {e.until && (
                                    <>
                                      {" "}{$rich("issues.page.until", { localTime: $el(<LocalTime iso={e.until} />) })}
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
