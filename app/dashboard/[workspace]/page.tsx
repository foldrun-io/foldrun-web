// Workspace overview — one desk, read the same way as the account home
// (mission-control.tsx): the status line, what needs attention here, what
// is running and what fires next, then the flows with their last runs as a
// strip, and the agents. Files live on Edit; runs on Runs.

import { viewerScope } from "@/server/users";
import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listFlows, listRuns, listWorkspaces } from "@/lib/store";
import { deployedCommit } from "@/lib/deploy";
import { avatarUrl } from "@/platform/avatars";
import { Avatar } from "@/components/avatar";
import { platform } from "@/lib/platform";
import { workspaceBudgetStanding } from "@/platform/limits";
import { AgentsPanel, FlowsPanel } from "@/components/workspace-desk";
import { AttentionPanel, NowNext, StatusStrip } from "@/components/mission-control";
import { needsList, flowStrips, nowBoard, spendWithin, DAY_MS } from "@/components/mission-model";
import { accountIssues } from "@/server/issues";
import { flowRows, agentRows, type NextFire } from "@/components/workspace-overview-model";
import { parseCron, nextFire, upcomingRuns } from "@/platform/scheduler";
import { fmtAgo, nowMs } from "@/components/overview-model";
import { creditsShort } from "@/components/money";
import { runLite } from "@/server/run-lite";
import { runCharges, runCharge, agentCharge } from "@/server/run-charges";
import { AutoRefresh } from "../run-button";
import { workspaceRuntimeReport } from "@/platform/runtime-warm.ts";
import { RuntimesPanel } from "@/components/workspace-runtimes";

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <AutoRefresh active={board.length > 0 || runtimeBuilding} />
      <header className="mb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <Avatar name={workspace} src={avatarUrl(tenant, "workspace", workspace)} size="lg" square />
              <h1 className="font-cal text-xl font-semibold tracking-tight text-fg">{workspace}</h1>
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              {summary?.description || `${agents.length} agent${agents.length === 1 ? "" : "s"} · ${flows.length} flow${flows.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <Link href={`/dashboard/${workspace}/edit${qs}`} className="font-medium text-fg-tertiary hover:text-fg">Source files →</Link>
            {/* The commit the last deploy named (foldrun deploy --commit), when
                it named one; either way, History is where the changes are. */}
            <Link href={`/dashboard/${workspace}/history${qs}`} className={`text-[11px] text-fg-subtle hover:text-fg-secondary ${commit ? "font-mono" : ""}`}>
              {commit ? `${commit.commit.slice(0, 7)} · deployed ${fmtAgo(now - Date.parse(commit.at))}` : "History →"}
            </Link>
          </div>
        </div>
      </header>

      <StatusStrip
        now={now}
        facts={{
          running: board.length,
          attention: needs.length,
          platform: needs.filter((a) => a.kind === "platform").length,
          next: upcoming[0] ? { flow: upcoming[0].flow, at: upcoming[0].at } : null,
          spendDayUsd: spendWithin(lite, now, DAY_MS),
          spend7dUsd: spendWithin(lite, now, 7 * DAY_MS),
          budget: budget !== null ? { text: `${creditsShort(spent)} of ${creditsShort(budget.usd)} ${window}`, warn: spent >= budget.usd * 0.8 } : null,
          links: {
            attention: needs.length ? "#attention" : `/dashboard/${workspace}/runs${qs}`,
            running: `/dashboard/${workspace}/runs?status=running${tenantParam}`,
            next: `/dashboard/${workspace}/triggers${qs}`,
            // The wallet is hosted furniture; elsewhere the spend is Usage.
            spend: platform.edition() === "hosted" ? `/dashboard/wallet${qs}` : `/dashboard/usage${qs}`,
          },
        }}
      />
      <AttentionPanel items={needs} tenant={tenant} showWorkspace={false} accountWide={accountWide} issuesHref={`/dashboard/issues?workspace=${encodeURIComponent(workspace)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`} />
      <NowNext board={board} upcoming={upcoming} now={now} tenant={tenant} showWorkspace={false} runsHref={`/dashboard/${workspace}/runs${qs}`} />
      <FlowsPanel workspace={workspace} tenant={tenant} flows={rows} strips={strips} now={now} />
      <RuntimesPanel runtimes={runtimes} />
      <AgentsPanel workspace={workspace} tenant={tenant} agents={agentRows(agents, runs, now, (r, a) => agentCharge(r, a, charges))} now={now} />
    </main>
  );
}
