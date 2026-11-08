// Workspace overview — one desk, read the same way as the account home
// (mission-control.tsx): the status line, what needs attention here, what
// is running and what fires next, then the flows with their last runs as a
// strip, and the agents. Files live on Edit; runs on Runs.

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
    const when = f.schedule ? (humanSchedule(f.schedule) ?? f.schedule) : f.trigger === "webhook" ? "Webhook" : f.trigger === "manual" ? "Run by hand" : f.trigger;
    const lastLine = last ? (
      <>
        <StatusDot outcome={last.outcome} label="" />
        <span className="truncate">
          {OUTCOME[last.outcome].label} {fmtSpan(now - Date.parse(last.startedAt))} ago
          {last.failure ? ` · ${last.failure.agent}: ${last.failure.reason}` : last.headline ? ` · ${last.headline}` : ""}
        </span>
      </>
    ) : (
      <>
        <CircleDashed />
        <span className="truncate">Never ran</span>
      </>
    );
    const nextLine = f.nextFireAt ? (
      <>
        <Clock3 />
        <span className="truncate">Next {fmtIn(Date.parse(f.nextFireAt) - now)}</span>
      </>
    ) : null;
    return {
      key: f.name,
      search: [f.name, when, last?.headline, last?.failure?.reason].filter(Boolean).join(" "),
      href,
      icon: <Workflow />,
      name: f.name,
      sub: `${when} · ${f.steps} step${f.steps === 1 ? "" : "s"}`,
      cells: {
        status: last ? <Status outcome={last.outcome} /> : <span className="text-fg-muted">Never ran</span>,
        runs: beat ? <Cells beat={beat} n={12} tenant={tenant} /> : undefined,
        next: f.nextFireAt ? fmtIn(Date.parse(f.nextFireAt) - now) : undefined,
        spend: `${f.runs7d} · ${creditsShort(f.spend7d)}`,
      },
      action: <RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label="Run" />,
      card: (
        <ResourceCard
          href={href}
          icon={<Workflow />}
          name={f.name}
          sub={when}
          status={f.live > 0 ? "busy" : outcomeRing(last?.outcome)}
          statusLabel={f.live > 0 ? `${f.live} running` : last ? OUTCOME[last.outcome].hint : "never ran"}
          lines={[lastLine, ...(nextLine ? [nextLine] : []), <><BarChart3 /><span className="truncate">{f.runs7d} run{f.runs7d === 1 ? "" : "s"} · {creditsShort(f.spend7d)} in 7 days</span></>]}
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
            <Fact label="Agents">{agents.length}</Fact>
            <Fact label="Flows">{flows.length}</Fact>
            {/* The commit the last deploy named (foldrun deploy --commit), when
                it named one; either way, History is where the changes are. */}
            <Link href={`/dashboard/${workspace}/history${qs}`} className="inline-flex items-center gap-1.5 hover:text-fg">
              <GitCommitHorizontal className="size-4" aria-hidden />
              {commit ? (
                <span>
                  <span className="font-mono">{commit.commit.slice(0, 7)}</span> deployed {fmtAgo(now - Date.parse(commit.at))}
                </span>
              ) : (
                "History"
              )}
            </Link>
          </>
        }
        actions={
          <>
            <Link href={`/dashboard/${workspace}/edit${qs}`} className={buttonVariants({ variant: "secondary" })}>
              <FolderTree aria-hidden />
              Files
            </Link>
            <Link href={`/dashboard/${workspace}/settings${qs}`} className={buttonVariants({ variant: "secondary", size: "icon-sm" })} aria-label="Workspace settings">
              <Settings aria-hidden />
            </Link>
          </>
        }
      />
      <SplitOverview
        search="Search flows…"
        title="Flows"
        actions={
          <Link href={`/dashboard/${workspace}/flows${qs}`} className={buttonVariants({ variant: "secondary" })}>
            All flows
          </Link>
        }
        columns={[
          { key: "status", header: "Last run" },
          { key: "runs", header: "Recent runs", hide: "lg" },
          { key: "next", header: "Next", hide: "md" },
          { key: "spend", header: "7 days", align: "end", hide: "sm" },
        ]}
        rows={flowRowsUi}
        empty={
          <EmptyState
            icon={<Workflow />}
            title="No flows yet"
            description="A flow is a numbered list of steps in flows/, each naming the agent that runs it."
            action={
              <>
                <Link href={`/dashboard/${workspace}/flows?create=flows${tenantParam}`} className={buttonVariants({ variant: "primary" })}>
                  New flow
                </Link>
                <Link href={`/dashboard/welcome?step=start${tenantParam}`} className={buttonVariants({ variant: "secondary" })}>
                  Other ways to start
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
            <Panel title="Agents" count={agentList.length} actions={<PanelLink href={`/dashboard/${workspace}/agents${qs}`}>All agents</PanelLink>} flush>
              {agentList.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-fg-muted">No agents yet.</p>
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
                        <span className="hidden shrink-0 text-xs text-fg-muted sm:block">{a.lastAt ? `ran ${fmtAgo(now - Date.parse(a.lastAt))}` : "never ran"}</span>
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
