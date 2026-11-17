// Workspace overview — one desk, read the same way as the account home
// (mission-control.tsx): the status line, what needs attention here, what
// is running and what fires next, then the flows with their last runs as a
// strip, and the agents. Files live on Edit; runs on Runs.

import { $rich, $t } from "@/i18n";
import { viewerScope, verifySession, SESSION_COOKIE } from "@/server/users";
import { cookies } from "next/headers";
import { onboardingPrefs, workspaceChecklistFor } from "@/server/onboarding";
import { WorkspaceChecklist } from "@/components/workspace-checklist";
import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listFlows, listRuns, listWorkspaces } from "@/lib/store";
import { deployedCommit } from "@/lib/deploy";
import { avatarUrl } from "@/platform/avatars";
import { Avatar } from "@/components/avatar";
import { platform } from "@/lib/platform";
import { workspaceBudgetStanding } from "@/platform/limits";
import { AttentionPanel, Cells, NowNext, SpendPanel, outcomeRing } from "@/components/mission-control";
import { needsList, flowStrips, nowBoard, spendWithin, fmtSpan, DAY_MS } from "@/components/mission-model";
import { accountIssues } from "@/server/issues";
import { flowRows, agentRows, fmtIn, type NextFire } from "@/components/workspace-overview-model";
import { parseCron, nextFire, upcomingRuns } from "@/platform/scheduler";
import { fmtAgo, nowMs } from "@/components/overview-model";
import { creditsShort } from "@/components/money";
import { runLite } from "@/server/run-lite";
import { runCharges, runCharge, agentCharge } from "@/server/run-charges";
import { AutoRefresh, RunButton } from "../run-button";
import { workspaceRuntimeReport } from "@/platform/runtime-warm.ts";
import { RuntimesPanel } from "@/components/workspace-runtimes";
import { Page, PageHeader, Fact, ResourceCard, EmptyState, IconBox, Panel, PanelLink } from "@foldrun/ui/react/page";
import { buttonVariants } from "@foldrun/ui/react/button";
import { SplitOverview } from "@foldrun/ui/react/overview";
import { Status, StatusDot } from "@/components/status";
import type { Row } from "@foldrun/ui/react/list";
import { OUTCOME } from "@/components/outcome-model";
import { humanSchedule } from "@/components/schedule-human";
import { BarChart3, Bot, CircleDashed, Clock3, FolderTree, GitCommitHorizontal, Settings, Workflow } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const now = nowMs();
  const nextFireAt: NextFire = (schedule, timezone, at) => {
    const cron = parseCron(schedule);
    return cron ? (nextFire(cron, new Date(at), timezone ?? "UTC")?.toISOString() ?? null) : null;
  };

  const agents = listAgents(tenant, workspace);
  const flows = listFlows(tenant, workspace);
  const runs = listRuns(tenant, workspace);
  const summary = listWorkspaces(tenant).find((w) => w.name === workspace);
  const commit = deployedCommit(tenant, workspace);
  const { budget, spentUsd: spent, window } = await workspaceBudgetStanding(tenant, workspace);

  const charges = await runCharges(tenant);
  const lite = runs.map((r) => runLite({ ...r, workspace }, charges));
  const board = nowBoard(lite, now);
  // Whether the viewer sees every workspace: only then may they act on a
  // platform issue, which is the account's.
  const accountWide = (await viewerScope()) === null;
  // This desk's issues, from its own runs (the page already checked access).
  const needs = needsList(lite, await accountIssues(tenant, null, now, lite, [workspace]), now);
  const upcoming = upcomingRuns(tenant, 500).filter((u) => u.workspace === workspace);
  const rows = flowRows(flows, runs, now, nextFireAt, (r) => runCharge(r, charges));
  const strips = flowStrips(rows.map((f) => f.name), lite, now);
  // What GET /runtimes answers: each runtime the agents declare and whether
  // the worker has built it. Empty — and the panel absent — when none do.
  const runtimes = workspaceRuntimeReport(tenant, workspace);
  const runtimeBuilding = runtimes.some((r) => r.state === "building" || r.state === "pending");

  const flowRowsUi: Row[] = rows.map((f) => {
    const beat = strips.get(f.name);
    const last = beat?.last ?? null;
    const href = `/dashboard/${workspace}/flows?flow=${encodeURIComponent(f.name)}${tenantParam}`;
    const when = f.schedule ? (humanSchedule(f.schedule) ?? f.schedule) : f.trigger === "webhook" ? $t("workspace.page.webhook") : f.trigger === "manual" ? $t("workspace.page.runByHand") : f.trigger;
    const lastLine = last ? (
      <>
        <StatusDot outcome={last.outcome} label="" />
        <span className="truncate">
          {$t("workspace.page.ago", { label: OUTCOME[last.outcome].label, fmtSpan: fmtSpan(now - Date.parse(last.startedAt)) })}
          {last.failure ? ` · ${last.failure.agent}: ${last.failure.reason}` : last.headline ? ` · ${last.headline}` : ""}
        </span>
      </>
    ) : (
      <>
        <CircleDashed />
        <span className="truncate">{$t("workspace.page.neverRan")}</span>
      </>
    );
    const nextLine = f.nextFireAt ? (
      <>
        <Clock3 />
        <span className="truncate">{$t("workspace.page.next", { fmtIn: fmtIn(Date.parse(f.nextFireAt) - now) })}</span>
      </>
    ) : null;
    return {
      key: f.name,
      search: [f.name, when, last?.headline, last?.failure?.reason].filter(Boolean).join(" "),
      href,
      icon: <Workflow />,
      name: f.name,
      sub: $t("workspace.page.step", { when: String(when), steps: String(f.steps), v2: String(f.steps === 1 ? "" : "s") }),
      cells: {
        status: last ? <Status outcome={last.outcome} /> : <span className="text-fg-muted">{$t("workspace.page.neverRan")}</span>,
        runs: beat ? <Cells beat={beat} n={12} tenant={tenant} /> : undefined,
        next: f.nextFireAt ? fmtIn(Date.parse(f.nextFireAt) - now) : undefined,
        spend: `${f.runs7d} · ${creditsShort(f.spend7d)}`,
      },
      action: <RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label={$t("workspace.page.run")} />,
      card: (
        <ResourceCard
          href={href}
          icon={<Workflow />}
          name={f.name}
          sub={when}
          status={f.live > 0 ? "busy" : outcomeRing(last?.outcome)}
          statusLabel={f.live > 0 ? `${f.live} running` : last ? OUTCOME[last.outcome].hint : $t("workspace.page.neverRan2")}
          lines={[lastLine, ...(nextLine ? [nextLine] : []), <><BarChart3 /><span className="truncate">{$t("workspace.page.runIn7Days", { runs7d: f.runs7d, creditsShort: creditsShort(f.spend7d) })}</span></>]}
        />
      ),
    };
  });
  const agentList = agentRows(agents, runs, now, (r, a) => agentCharge(r, a, charges));
  // What this desk still needs before it can be left to run (cloudhost's
  // Production checklist), hidden per person.
  const person = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const checklist = workspaceChecklistFor(tenant, workspace, onboardingPrefs(person?.prefs));

  return (
    <Page>
      <AutoRefresh active={board.length > 0 || runtimeBuilding} />
      <PageHeader
        icon={<Avatar name={workspace} src={avatarUrl(tenant, "workspace", workspace)} size="lg" square />}
        title={workspace}
        description={summary?.description || undefined}
        meta={
          <>
            <Fact label={$t("workspace.page.agents")}>{agents.length}</Fact>
            <Fact label={$t("workspace.page.flows")}>{flows.length}</Fact>
            {/* The commit the last deploy named (foldrun deploy --commit), when
                it named one; either way, History is where the changes are. */}
            <Link href={`/dashboard/${workspace}/history${qs}`} className="inline-flex items-center gap-1.5 hover:text-fg">
              <GitCommitHorizontal className="size-4" aria-hidden />
              {commit ? (
                <span>
                  {$rich("workspace.page.deployed", { slice: commit.commit.slice(0, 7), span: (chunks) => <span className="font-mono">{chunks}</span>, fmtAgo: fmtAgo(now - Date.parse(commit.at)) })}
                </span>
              ) : (
                $t("workspace.page.history")
              )}
            </Link>
          </>
        }
        actions={
          <>
            <Link href={`/dashboard/${workspace}/edit${qs}`} className={buttonVariants({ variant: "secondary" })}>
              <FolderTree aria-hidden />
              {$t("workspace.page.files")}
            </Link>
            <Link href={`/dashboard/${workspace}/settings${qs}`} className={buttonVariants({ variant: "secondary", size: "icon-sm" })} aria-label={$t("workspace.page.workspaceSettings")}>
              <Settings aria-hidden />
            </Link>
          </>
        }
      />
      <SplitOverview
        search={$t("workspace.page.searchFlows")}
        title={$t("workspace.page.flows")}
        actions={
          <Link href={`/dashboard/${workspace}/flows${qs}`} className={buttonVariants({ variant: "secondary" })}>
            {$t("workspace.page.allFlows")}
          </Link>
        }
        columns={[
          { key: "status", header: $t("workspace.page.lastRun") },
          { key: "runs", header: $t("workspace.page.recentRuns"), hide: "lg" },
          { key: "next", header: $t("workspace.page.next2"), hide: "md" },
          { key: "spend", header: $t("workspace.page.7Days"), align: "end", hide: "sm" },
        ]}
        rows={flowRowsUi}
        empty={
          <EmptyState
            icon={<Workflow />}
            title={$t("workspace.page.noFlowsYet")}
            description={$t("workspace.page.aFlowIsANumberedList")}
            action={
              <>
                <Link href={`/dashboard/${workspace}/flows?create=flows${tenantParam}`} className={buttonVariants({ variant: "primary" })}>
                  {$t("workspace.page.newFlow")}
                </Link>
                <Link href={`/dashboard/welcome?step=start${tenantParam}`} className={buttonVariants({ variant: "secondary" })}>
                  {$t("workspace.page.otherWaysToStart")}
                </Link>
              </>
            }
          />
        }
        left={
          <>
            {checklist.show && <WorkspaceChecklist data={checklist} qs={qs} canHide={Boolean(person)} />}
            <AttentionPanel items={needs} tenant={tenant} showWorkspace={false} accountWide={accountWide} issuesHref={`/dashboard/issues?workspace=${encodeURIComponent(workspace)}${tenantParam}`} />
            <NowNext board={board} upcoming={upcoming} now={now} tenant={tenant} showWorkspace={false} runsHref={`/dashboard/${workspace}/runs${qs}`} />
            <SpendPanel
              dayUsd={spendWithin(lite, now, DAY_MS)}
              weekUsd={spendWithin(lite, now, 7 * DAY_MS)}
              budget={budget !== null ? { spentUsd: spent, limitUsd: budget.usd, label: window } : null}
              href={platform.edition() === "hosted" ? `/dashboard/wallet${qs}` : `/dashboard/usage${qs}`}
            />
          </>
        }
        after={
          <>
            <RuntimesPanel runtimes={runtimes} />
            <Panel title={$t("workspace.page.agents")} count={agentList.length} actions={<PanelLink href={`/dashboard/${workspace}/agents${qs}`}>{$t("workspace.page.allAgents")}</PanelLink>} flush>
              {agentList.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-fg-muted">{$t("workspace.page.noAgentsYet")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {agentList.map((a) => (
                    <li key={a.name}>
                      <Link href={`/dashboard/${workspace}/agents/${encodeURIComponent(a.name)}${qs}`} className="flex min-w-0 items-center gap-3 px-5 py-3 hover:bg-sunken">
                        <IconBox>
                          <Bot />
                        </IconBox>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">{a.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{a.description || a.model}</span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-fg-muted sm:block">{a.lastAt ? `ran ${fmtAgo(now - Date.parse(a.lastAt))}` : $t("workspace.page.neverRan2")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        }
      />
    </Page>
  );
}
