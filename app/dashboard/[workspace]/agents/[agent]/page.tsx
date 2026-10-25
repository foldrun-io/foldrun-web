// One agent, and everything it has actually done.
//
// The runs list is keyed by flow, which answers "did Monday's flow finish".
// It cannot answer "is this agent any good" — an agent that appears in four
// flows has its work spread across four filters, and one that runs on its own
// is only findable by knowing the `adhoc:` prefix. This is the other axis:
// what it is allowed to do at the top, what it has produced underneath.

import Link from "next/link";
import fs from "node:fs";
import { Pager } from "@/components/pager";
import { paginate, pageFrom } from "@/components/paging";
import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/workspace-header";
import { workspaceDir, listAgents, listAgentSteps, agentAssets, listFlows } from "@/lib/store";
import { Badge, Card, EmptyScreen, PageHeader } from "@/components/ui";
import { Email } from "@/components/email";
import { ExportLink } from "@/components/package-buttons";
import { LocalTime } from "@/components/local-time";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { readNetwork, TRUSTED_SITES } from "@/lib/network";
import { AgentNetwork } from "./agent-network";

export const dynamic = "force-dynamic";

const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

// Times go through LocalTime, never toLocaleString here: this is a server
// component, so formatting on the box would show every viewer the box's clock
// rather than the zone they chose on their profile.
const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

const STEP_TONE: Record<string, "success" | "warning" | "error" | "default"> = {
  completed: "success",
  failed: "error",
  "awaiting-approval": "warning",
  running: "warning",
  skipped: "default",
  pending: "default",
};

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; agent: string }>;
  searchParams: Promise<{ tenant?: string; page?: string }>;
}) {
  const { workspace, agent } = await params;
  const { tenant = "default", page: pageParam } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const info = listAgents(tenant, workspace).find((a) => a.name === agent);
  if (!info) notFound();

  const steps = listAgentSteps(tenant, workspace, agent);
  const activity = paginate(steps, pageFrom(pageParam));
  const assets = agentAssets(tenant, workspace, agent);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const callers = listFlows(tenant, workspace)
    .filter((f) => f.steps.some((s) => !s.subflow && s.agent === agent))
    .map((f) => f.name);

  // Spend and reliability over what is on record — the two questions a person
  // opens this page with, answered before the list rather than by reading it.
  // The agent's network: what its file says, and what a run resolves it to.
  const agentFile = path.join(workspaceDir(tenant, workspace), "agents", agent, "agent.md");
  const ownNetwork = readNetwork(configMatter(fs.readFileSync(agentFile, "utf8")).data.network).setting;
  const spend = steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const failed = steps.filter((s) => s.stepStatus === "failed").length;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title={agent}
        subtitle={
          <>
            {info.description || "No description"}
            {info.owner && (
              <span className="ml-2 text-fg-subtle">
                · owner <Email value={info.owner} />
                {info.ownerFrom !== "agent" && ` (from the ${info.ownerFrom})`}
              </span>
            )}
          </>
        }
      >
        <Link
            href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`agents/${agent}/agent.md`)}${qs.replace("?", "&")}`}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-fg-secondary hover:bg-sunken"
          >
          Edit agent.md
        </Link>
        <ExportLink
          workspace={workspace}
          kind="agent"
          name={agent}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-fg-secondary hover:bg-sunken"
        />
      </PageHeader>

      <Card className="mt-4 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">What it may do</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="info">{info.model}</Badge>
          {info.effort ? <Badge variant="info">effort: {info.effort}</Badge> : null}
          {info.tools.length ? info.tools.map((t) => <Badge key={t}>{t}</Badge>) : <Badge>no tools</Badge>}
          {info.apis.map((a) => (
            <Badge key={a.name} variant="info">{a.name}</Badge>
          ))}
          {info.consults.map((c) => (
            <Badge key={c} variant="info">consults {c}</Badge>
          ))}
          {(info.subagents ?? []).map((c) => (
            <Badge key={`sub-${c}`} variant="info">delegates to {c}</Badge>
          ))}
          {info.secrets.map((s) => (
            <Badge key={s} variant="warning">{s}</Badge>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
          <span><span className="text-fg-subtle">own skills</span> {assets.skills.length}</span>
          <span><span className="text-fg-subtle">own memory</span> {assets.memory.length}</span>
          <span>
            <span className="text-fg-subtle">skills</span>{" "}
            {info.skills === null ? "inherits every skill in scope" : info.skills.join(", ") || "none — [] withholds all"}
          </span>
          <span>
            <span className="text-fg-subtle">called by</span> {callers.length ? callers.join(", ") : "no flow"}
          </span>
        </p>
      </Card>

      <AgentNetwork
        tenant={tenant}
        workspace={workspace}
        agent={agent}
        own={ownNetwork}
        resolved={info.network}
        trustedCount={TRUSTED_SITES.length}
        // The agent PATCH refuses a viewer's write; the page does not guess the role.
        editable
      />

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm text-fg-tertiary">
        <span><span className="text-fg-subtle">steps on record</span> {steps.length}</span>
        <span><span className="text-fg-subtle">failed</span> {failed}</span>
        <span><span className="text-fg-subtle">spend</span> {money(spend)}</span>
      </div>

      {steps.length === 0 ? (
        <div className="mt-4">
          <EmptyScreen
            title="This agent has not run yet"
            description="Run it from the agents list, or from a flow that steps through it. Every step it runs appears here with the line it opened its reply with."
          />
        </div>
      ) : (
        <Card className="mt-4">
          <ul className="divide-y divide-line-faint">
            {activity.rows.map((s, i) => (
              <li key={`${s.runId}:${i}`} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <Link
                    href={`/dashboard/${workspace}/runs/${s.runId}${qs}`}
                    className="truncate text-sm font-medium text-fg hover:underline"
                  >
                    {/* The step's OWN first line, not the run's summary — this
                        agent's conclusion, even when a later step ran after it. */}
                    {s.headline ?? <span className="text-fg-subtle">no reply recorded</span>}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                    {s.costUsd ? money(s.costUsd) : "—"}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <Badge variant={STEP_TONE[s.stepStatus] ?? "default"}>{s.stepStatus}</Badge>
                  <span>{s.flow.startsWith("adhoc:") ? "run directly" : s.flow}</span>
                  {s.item ? <span className="truncate text-fg-subtle">on {s.item}</span> : null}
                  {s.denied ? (
                    <span className="text-amber-700" title="Reached for a path outside the workspace and was refused. Each one is a wasted turn; name the path in the agent's prompt.">
                      {s.denied} path{s.denied === 1 ? "" : "s"} refused
                    </span>
                  ) : null}
                  <LocalTime iso={s.startedAt} options={WHEN} className="tabular-nums" />
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pager base={`/dashboard/${workspace}/agents/${agent}`} page={activity.page} pages={activity.pages} total={activity.total} tenantParam={qs.replace("?", "&")} labels={["← Newer", "Older →"]} />
    </main>
  );
}
