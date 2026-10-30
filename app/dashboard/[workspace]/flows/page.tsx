// Flows — the other primary noun. A flow file is the orchestration: which
// agents run, in what order, what runs in parallel, and where a human is
// asked. This page renders that structure group by group, so you can read a
// flow without opening the markdown.

import { RunDot } from "./run-dot";
import { WorkspaceHeader } from "@/components/workspace-header";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listFlows, listRuns, parseProvider, accountDir, runCost, runDisplayStatus } from "@/lib/store";
import { lintFlow } from "@/lib/flow-lint";
import { workspaceTools } from "@/lib/store";
import { libraryTools } from "@/lib/library";
import { readCatalog, refreshCatalogSoon, lintFlowModels, type AgentModelInfo } from "@/lib/catalog";
import { configMatter } from "@/lib/matter";
import path from "node:path";
import { RunButton } from "../../run-button";
import { DeleteButton } from "../../manage";
import { CreateButton } from "@/components/create";
import { Badge, EmptyScreen, PageHeader } from "@/components/ui";
import { CollapsibleCard, CollapseAll } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import { FlowBoard } from "./flow-board";
import { FlowCanvas } from "./flow-canvas";
import { FlowView } from "./flow-view";
import { FlowHistory } from "@/components/flow-history";
import { ExportLink, ImportPackageButton } from "@/components/package-buttons";
import { FlowRunWith } from "@/components/flow-run-with";
import { FlowAiDraft } from "@/components/flow-ai-draft";
import { AskAiButton } from "@/components/assistant";
import { liteRun, type AgentTeam } from "@/components/flow-canvas-model";
import { TriggerEditor } from "./trigger-editor";
import { ComputeCard } from "@/components/defaults-cards";
import { computeHeld } from "@/platform/limits";
import { ListSearch } from "@/components/list-search";
import { humanSchedule } from "@/components/schedule-human";

export const dynamic = "force-dynamic";

export default async function FlowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const flows = listFlows(tenant, workspace);
  const held = computeHeld(tenant, [workspace]);
  // One read serves every card: the strip of recent runs under each flow, and
  // the "what will this cost me" estimate next to its Run button.
  const allRuns = listRuns(tenant, workspace);
  const historyFor = (name: string) => allRuns.filter((r) => r.flow === name).slice(0, 14);
  const minutesOf = (r: (typeof allRuns)[number]) =>
    r.finishedAt ? (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 60000 : null;
  /**
   * What recent runs of this flow actually cost — as a RANGE, not an average.
   *
   * An average was the first attempt and it lied: a flow whose two completed
   * runs cost $7.46 and $0.07 was advertised at "$3.76", a figure neither run
   * came close to. A flow costs what it does — more pages crawled, more leads
   * found, more tokens — so the honest summary of the past is its spread.
   */
  const previewFor = (name: string) => {
    // Completed runs only: a failed run's cost says how far it got, not what
    // the flow costs. The last few, because flows drift.
    const done = allRuns.filter((r) => r.flow === name && r.status === "completed").slice(0, 5);
    if (done.length === 0) return null;
    const costs = done.map(runCost).sort((a, b) => a - b);
    const mins = done.map(minutesOf).filter((m): m is number => m != null).sort((a, b) => a - b);
    const money = (n: number) => `$${n.toFixed(2)}`;
    const time = (n: number) => (n < 1 ? "<1" : String(Math.round(n)));
    // One number only when the runs agree; otherwise say both ends.
    const tight = costs[costs.length - 1] <= costs[0] * 1.5;
    return {
      n: done.length,
      cost: tight ? `≈ ${money(costs[0])}` : `${money(costs[0])}–${money(costs[costs.length - 1])}`,
      time:
        mins.length === 0
          ? null
          : mins[mins.length - 1] <= mins[0] * 1.5
            ? `≈ ${time(mins[0])} min`
            : `${time(mins[0])}–${time(mins[mins.length - 1])} min`,
    };
  };
  // Which flows call each agent. An agent belongs to the workspace, not to
  // the flow you happen to be reading, and editing one from a flow card must
  // not imply otherwise.
  const usedBy: Record<string, string[]> = {};
  for (const flow of flows) {
    for (const step of flow.steps) {
      if (step.subflow) continue;
      const list = (usedBy[step.agent] ??= []);
      if (!list.includes(flow.name)) list.push(flow.name);
    }
  }
  const agents = listAgents(tenant, workspace);
  const agentNames = agents.map((a) => a.name);
  // What the canvas draws under each step: the agent's team, read from the
  // same listAgents the graph page reads consults and sub-agents from.
  const teams: AgentTeam[] = agents.map((a) => ({
    name: a.name,
    description: a.description,
    model: a.model,
    effort: a.effort,
    tools: a.tools,
    consults: a.consults,
    subagents: a.subagents,
  }));
  const flowNames = flows.map((f) => f.name);

  // The run-start gate's knowledge, at edit time: when a gateway is declared,
  // warn about steps whose model its catalogue says cannot call tools. Served
  // from the cache and refreshed in the background — a page render never
  // waits on someone else's API.
  const frontOf = (base: string) => {
    try {
      return configMatter(fs.readFileSync(path.join(base, "AGENTS.md"), "utf8")).data as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const provider = parseProvider(
    frontOf(workspaceDir(tenant, workspace)).provider ?? frontOf(accountDir(tenant)).provider,
  );
  const catalog = provider?.baseUrl ? readCatalog(provider.baseUrl) : null;
  if (provider?.baseUrl) refreshCatalogSoon(provider.baseUrl);
  const agentModels: AgentModelInfo[] = agents.map((a) => ({
    name: a.name,
    model: a.model,
    usesTools: a.tools.length > 0 || a.apis.length > 0,
  }));
  // Which agents can act outside the workspace, so the dashboard shows the
  // same refusal the CLI does rather than a quieter version of it.
  const workspaceToolDefs = { ...libraryTools(tenant), ...workspaceTools(tenant, workspace) };
  const outwardAgents = agents
    .filter((a) => a.tools.some((t) => workspaceToolDefs[t]?.outward === true))
    .map((a) => a.name);
  const warningsFor = (f: (typeof flows)[number]) => [
    ...lintFlow(f, { agents: agents.map((a) => a.name), outwardAgents }),
    ...lintFlowModels(f, agentModels, catalog, provider?.models ?? {}),
  ];
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rawOf = (file: string) => {
    try {
      return fs.readFileSync(path.join(workspaceDir(tenant, workspace), "flows", file), "utf8");
    } catch {
      return "";
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Flows"
        subtitle="Orchestration lives here, not inside any agent. On the canvas, drag a step into a column to run it in parallel or between columns to make it its own step; drag agents and patterns in from the palette."
      >
        <ImportPackageButton tenant={tenant} workspace={workspace} />
        <AskAiButton label="Draft with AI" prompt="Draft a flow that " title="Describe a flow; the assistant writes it and any agents it needs, checked, for you to save" />
        <CreateButton
          kind="flows"
          tenant={tenant}
          workspace={workspace}
          // Examples, not types: every choice writes a plain flow file you
          // then edit into whatever you need. The options that make these
          // shapes work (loop:, each:, case:) are ordinary flow grammar,
          // documented in the SPEC and editable per step with the gear.
          variants={{
            key: "pattern",
            choices: [
              { value: "pipeline", label: "Basic flow", hint: "Steps in order, one agent each. The shape you edit into anything.", section: "Start from scratch" },
              { value: "review-loop", label: "Review loop", hint: "A maker and a checker — the loop repeats until the checker approves.", section: "Start from an example" },
              { value: "fan-out", label: "Fan-out", hint: "One step runs once per line of a list, in parallel.", section: "Start from an example" },
              { value: "debate", label: "Debate", hint: "Two agents take positions; a third weighs them and decides.", section: "Start from an example" },
              { value: "router", label: "Router", hint: "A triage step whose verdict picks which branch runs.", section: "Start from an example" },
            ],
          }}
        />
      </PageHeader>

      {flows.length === 0 ? (
        <EmptyScreen
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="12" cy="18" r="2" />
              <path d="M7 7.5 10.5 16M17 7.5 13.5 16" />
            </svg>
          }
          title="No flows in this workspace yet"
          description="A flow is a numbered list of [[agent]] links under flows/. One agent per line; repeat a number to run those agents in parallel."
        />
      ) : (
        <>
        <div className="mb-4 flex items-center gap-3">
          <ListSearch listId="flows-list" placeholder="Search flows…" total={flows.length} noun="flows" className="!mb-0 min-w-0 flex-1" />
          <CollapseAll scope={`flows:${workspace}`} />
        </div>
        <ul id="flows-list" className="space-y-3">
          {flows.map((f) => {
            const search = [f.name, f.file, f.trigger, f.schedule ?? "", ...f.steps.map((s) => s.agent)].join(" ");
            const warnings = warningsFor(f);
            const errors = warnings.filter((w) => w.level === "error").length;
            const warns = warnings.length - errors;
            return (
            <li key={f.file} data-search={search}>
            <CollapsibleCard
              id={anchorId("flow", f.name)}
              scope={`flows:${workspace}`}
              item={f.name}
              search={search}
              // A flow whose check has ERRORS starts expanded, so the problem
              // is on screen without a click; a viewer's own choice still wins.
              // Warnings alone stay collapsed behind their count.
              defaultOpen={errors > 0}
              title={f.name}
              subtitle={<span className="font-mono">flows/{f.file}</span>}
              meta={
                <>
                    <Badge variant="info">{f.trigger}</Badge>
                    {f.schedule && (
                      <Badge className="font-normal" title={f.schedule}>
                        {humanSchedule(f.schedule) ?? f.schedule}
                        {f.timezone ? ` · ${f.timezone}` : ""}
                      </Badge>
                    )}
                    <TriggerEditor
                      workspace={workspace}
                      flow={f.name}
                      trigger={f.trigger ?? "manual"}
                      schedule={f.schedule}
                      timezone={f.timezone}
                    />
                    {f.model && <Badge variant="info">model: {f.model}</Badge>}
                    {f.compute && (
                      <Badge title="compute: — what one run's steps may hold together at once">
                        each run: {[f.compute.vcpu !== undefined ? `${f.compute.vcpu} vCPU` : null, f.compute.memGiB !== undefined ? `${f.compute.memGiB} GiB` : null, f.compute.diskGiB !== undefined ? `${f.compute.diskGiB} GiB disk` : null].filter(Boolean).join(" · ")}
                      </Badge>
                    )}
                    <Badge>
                      {f.steps.length} step{f.steps.length === 1 ? "" : "s"}
                    </Badge>
                    {errors > 0 && (
                      <Badge variant="error" title="foldrun check errors — open the card to read them">
                        {errors} error{errors === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {warns > 0 && (
                      <Badge variant="warning" title="foldrun check warnings — open the card to read them">
                        {warns} warning{warns === 1 ? "" : "s"}
                      </Badge>
                    )}

              {historyFor(f.name).length > 0 && (
                <div className="mt-1 flex basis-full flex-wrap items-center gap-1">
                  {/* Oldest → newest, like a sparkline reads. Each cell is the
                      run itself: outcome by colour, the details on hover, the
                      run page one click away. */}
                  {historyFor(f.name)
                    .slice()
                    .reverse()
                    .map((r) => {
                      const display = runDisplayStatus(r);
                      const mins = r.finishedAt
                        ? (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 60000
                        : null;
                      const colour =
                        display === "completed"
                          ? "bg-emerald-400 hover:bg-emerald-500"
                          : display === "failed"
                            ? "bg-red-400 hover:bg-red-500"
                            : display === "stopped"
                              ? "bg-gray-300 hover:bg-gray-400"
                              : display === "awaiting-approval"
                                ? "bg-amber-400 hover:bg-amber-500"
                                : "bg-sky-400 hover:bg-sky-500"; // running / queued
                      return (
                        <RunDot
                          key={r.id}
                          href={`/dashboard/${workspace}/runs/${r.id}${tenant !== "default" ? `?tenant=${tenant}` : ""}`}
                          label={`${display} · $${runCost(r).toFixed(2)}${mins != null ? ` · ${mins < 1 ? "<1" : Math.round(mins)} min` : ""}`}
                          startedAt={r.startedAt}
                          className={`h-2.5 w-2.5 rounded-sm transition-colors ${colour}`}
                        />
                      );
                    })}
                  {(() => {
                    const p = previewFor(f.name);
                    const runs = historyFor(f.name).length;
                    return (
                      <span
                        className="ml-1.5 text-[11px] text-fg-subtle"
                        title={
                          p
                            ? `From the last ${p.n} completed run${p.n === 1 ? "" : "s"}. What a run costs depends on how much work it finds, so this is a range, not a price.`
                            : undefined
                        }
                      >
                        last {runs} run{runs === 1 ? "" : "s"}
                        {p && (
                          <>
                            {" · "}
                            <span className="tabular-nums">{p.cost}</span>
                            {p.time && <> · <span className="tabular-nums">{p.time}</span></>}
                          </>
                        )}
                      </span>
                    );
                  })()}
                </div>
              )}

                </>
              }
              actions={
                <>
                  <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <ExportLink
                      workspace={workspace}
                      kind="flow"
                      name={f.name}
                      className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-sunken hover:text-fg"
                    />
                    <DeleteButton
                      endpoint={`/api/workspaces/${workspace}/source`}
                      tenant={tenant}
                      body={{ path: `flows/${f.file}` }}
                      confirmText={`Delete flow ${f.name}?`}
                    />
                  </span>
                  <RunButton
                    endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`}
                    tenant={tenant}
                    label="Run flow"
                  />
                </>
              }
            >
              {warnings.length > 0 && (
                <ul className="mb-3 space-y-1.5">
                  {warnings.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
                    >
                      <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          className="mt-px shrink-0"
                          aria-hidden
                        >
                          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                        </svg>
                        {w.message}
                      </p>
                      <p className="mt-1 pl-[19px] text-xs leading-relaxed text-amber-800">
                        {w.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {/* Each run's own pool (27 Oct 2026): what one run of this flow may hold at once. */}
              <div className="mb-3">
                <ComputeCard
                  endpoint={`/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(f.name)}`}
                  tenant={tenant}
                  level="flow"
                  initial={f.compute ? { vcpu: f.compute.vcpu ?? null, memGiB: f.compute.memGiB ?? null, diskGiB: f.compute.diskGiB ?? null } : null}
                  pool={{ vcpu: f.compute?.vcpu ?? null, memGiB: f.compute?.memGiB ?? null, diskGiB: f.compute?.diskGiB ?? null }}
                  // The cap is each run's: shown against its busiest live run, never a sum of several.
                  inUse={held.runs.filter((r) => r.flow === f.name).map((r) => r.inUse).reduce((a, r) => (r.vcpu + r.memGiB + r.diskGiB > a.vcpu + a.memGiB + a.diskGiB ? r : a), { vcpu: 0, memGiB: 0, diskGiB: 0, steps: 0 })}
                />
              </div>

              <FlowView
                toolbar={
                  <>
                    <FlowAiDraft workspace={workspace} tenant={tenant} flow={f.name} />
                    <FlowHistory workspace={workspace} tenant={tenant} flow={f.name} file={f.file} />
                    <FlowRunWith workspace={workspace} tenant={tenant} flow={f.name} />
                  </>
                }
                canvas={
                  <FlowCanvas
                    workspace={workspace}
                    tenant={tenant}
                    flow={f.name}
                    file={f.file}
                    trigger={f.trigger ?? "manual"}
                    schedule={f.schedule}
                    timezone={f.timezone}
                    steps={f.steps}
                    agents={teams}
                    knownFlows={flowNames}
                    // The same warnings the card lists, placed on the step
                    // they are about — the checks `foldrun check` runs.
                    warnings={warnings.map((w) => ({ step: w.step, message: w.message, level: w.level }))}
                    usedBy={usedBy}
                    // The file itself (copy slices it, undo starts from it)
                    // and the same recent runs as the dots above, cut down
                    // to what the run overlay draws.
                    raw={rawOf(f.file)}
                    runs={historyFor(f.name).map(liteRun)}
                  />
                }
                list={
                  // Remount when the flow's shape changes, so the board's
                  // step indices never outlive the steps they point at.
                  <FlowBoard
                    name={f.name}
                    // Which other flows call each agent — so opening an agent's
                    // file from inside one flow says, before you type, how far
                    // the change reaches.
                    usedBy={usedBy}
                    key={f.steps.map((s) => `${s.group}:${s.subflow ?? s.agent}`).join("|")}
                    workspace={workspace}
                    tenant={tenant}
                    flow={f.name}
                    file={f.file}
                    steps={f.steps}
                    raw={rawOf(f.file)}
                    knownAgents={agentNames}
                    knownFlows={flowNames}
                  />
                }
              />
            </CollapsibleCard>
            </li>
            );
          })}
        </ul>
        </>
      )}
    </main>
  );
}
