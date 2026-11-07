// Flows — the other primary noun. A flow file is the orchestration: which
// agents run, in what order, what runs in parallel, and where a human is
// asked.
//
// Two views of one route: `/flows` is the list (what starts each flow, how
// its last runs went, when it fires next), and `/flows?flow=<name>` is one
// flow — its steps on the canvas, its runs and its settings, in tabs
// (`&tab=runs|settings`). `?create=flows` opens the New flow dialog.

import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listFlows, listRuns, parseProvider, accountDir, runCost, workspaceTools, type FlowInfo, type RunRecord } from "@/lib/store";
import { lintFlow } from "@/lib/flow-lint";
import { libraryTools } from "@/lib/library";
import { readCatalog, refreshCatalogSoon, lintFlowModels, type AgentModelInfo } from "@/lib/catalog";
import { configMatter } from "@/lib/matter";
import { parseCron, nextFire } from "@/platform/scheduler";
import { computeHeld } from "@/platform/limits";
import { RunButton } from "../../run-button";
import { DeleteButton } from "../../manage";
import { CreateButton } from "@/components/create";
import { ExportLink, ImportPackageButton } from "@/components/package-buttons";
import { FlowHistory } from "@/components/flow-history";
import { FlowRunWith } from "@/components/flow-run-with";
import { FlowAiDraft } from "@/components/flow-ai-draft";
import { AskAiButton } from "@/components/assistant";
import { A2aPublish } from "@/components/a2a-publish";
import { ComputeCard } from "@/components/defaults-cards";
import { LocalTime } from "@/components/local-time";
import { Cells, outcomeRing } from "@/components/mission-control";
import { flowStrips, fmtSpan } from "@/components/mission-model";
import { flowRows, fmtIn, type NextFire } from "@/components/workspace-overview-model";
import { liteRun, type AgentTeam } from "@/components/flow-canvas-model";
import { anchorId } from "@/components/collapse-model";
import { creditsShort } from "@/components/money";
import { nowMs } from "@/components/overview-model";
import { OUTCOME } from "@/components/outcome-model";
import { runLite } from "@/server/run-lite";
import { Page, PageHeader, IconBox, Tag, Fact, Panel, PanelList, SettingsCard, EmptyState, ResourceCard } from "@/components/kit/page";
import { ResourceList, type Row } from "@/components/kit/list";
import { PageTabs } from "@/components/kit/page-tabs";
import { Status, StatusDot } from "@/components/kit/status";
import { buttonVariants } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { AlertTriangle, CircleDashed, Clock3, FilePen, Layers, Workflow, XCircle } from "lucide-react";
import { FlowBoard } from "./flow-board";
import { FlowCanvas } from "./flow-canvas";
import { FlowView } from "./flow-view";
import { TriggerEditor } from "./trigger-editor";
import { FlowHashRedirect, FlowMoreMenu } from "./flow-actions";
import { triggerLine, triggerWord } from "./trigger-line";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default async function FlowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; flow?: string; tab?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", flow: chosen, tab = "steps" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const flows = listFlows(tenant, workspace);
  // One read serves every flow: the cells of recent runs, the last run's
  // outcome, and the "what will this cost me" range next to its Run button.
  const allRuns = listRuns(tenant, workspace);
  const now = nowMs();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}/flows`;
  const flowHref = (name: string) => `${base}?flow=${encodeURIComponent(name)}${tenantParam}`;
  const nextFireAt: NextFire = (schedule, timezone, at) => {
    const cron = parseCron(schedule);
    return cron ? (nextFire(cron, new Date(at), timezone ?? "UTC")?.toISOString() ?? null) : null;
  };
  const lite = allRuns.map((r) => runLite({ ...r, workspace }));
  const strips = flowStrips(flows.map((f) => f.name), lite, now);
  const rows = new Map(flowRows(flows, allRuns, now, nextFireAt).map((r) => [r.name, r]));

  const minutesOf = (r: RunRecord) => (r.finishedAt ? (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 60000 : null);
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
      time: mins.length === 0 ? null : mins[mins.length - 1] <= mins[0] * 1.5 ? `≈ ${time(mins[0])} min` : `${time(mins[0])}–${time(mins[mins.length - 1])} min`,
    };
  };
  const costTitle = (p: { n: number }) => `From the last ${plural(p.n, "completed run")}. What a run costs depends on how much work it finds, so this is a range, not a price.`;

  // The checks `foldrun check` runs, per flow: the agents a step names, the
  // ones that can act outside the workspace, and — when a gateway is
  // declared — steps whose model its catalogue says cannot call tools.
  // Served from the cache and refreshed in the background: a page render
  // never waits on someone else's API.
  const agents = listAgents(tenant, workspace);
  const frontOf = (dir: string) => {
    try {
      return configMatter(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).data as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const provider = parseProvider(frontOf(workspaceDir(tenant, workspace)).provider ?? frontOf(accountDir(tenant)).provider);
  const catalog = provider?.baseUrl ? readCatalog(provider.baseUrl) : null;
  if (provider?.baseUrl) refreshCatalogSoon(provider.baseUrl);
  const agentModels: AgentModelInfo[] = agents.map((a) => ({ name: a.name, model: a.model, usesTools: a.tools.length > 0 || a.apis.length > 0 }));
  const workspaceToolDefs = { ...libraryTools(tenant), ...workspaceTools(tenant, workspace) };
  const outwardAgents = agents.filter((a) => a.tools.some((t) => workspaceToolDefs[t]?.outward === true)).map((a) => a.name);
  const warningsFor = (f: FlowInfo) => [...lintFlow(f, { agents: agents.map((a) => a.name), outwardAgents }), ...lintFlowModels(f, agentModels, catalog, provider?.models ?? {})];

  // ---------- one flow ----------

  if (chosen) {
    const f = flows.find((x) => x.name === chosen);
    if (!f) {
      return (
        <Page>
          <PageHeader back={{ href: `${base}${qs}`, label: "Flows" }} title={chosen} />
          <EmptyState
            icon={<Workflow />}
            title="No flow by that name"
            description="It may have been renamed or deleted. Its past runs stay on the Runs page."
            action={
              <Link href={`${base}${qs}`} className={buttonVariants({ variant: "secondary" })}>
                All flows
              </Link>
            }
          />
        </Page>
      );
    }
    {
      const held = computeHeld(tenant, [workspace]);
      const warnings = warningsFor(f);
      const errors = warnings.filter((w) => w.level === "error").length;
      const own = lite.filter((r) => r.what === f.name);
      const last = own[0] ?? null;
      const row = rows.get(f.name);
      const preview = previewFor(f.name);
      const history = allRuns.filter((r) => r.flow === f.name).slice(0, 14);
      // Which flows call each agent. An agent belongs to the workspace, not
      // to the flow you happen to be reading, and editing one from a flow
      // must not imply otherwise.
      const usedBy: Record<string, string[]> = {};
      for (const flow of flows) {
        for (const step of flow.steps) {
          if (step.subflow) continue;
          const list = (usedBy[step.agent] ??= []);
          if (!list.includes(flow.name)) list.push(flow.name);
        }
      }
      // What the canvas draws under each step: the agent's team.
      const teams: AgentTeam[] = agents.map((a) => ({ name: a.name, description: a.description, model: a.model, effort: a.effort, tools: a.tools, consults: a.consults, subagents: a.subagents }));
      const flowNames = flows.map((x) => x.name);
      let raw = "";
      try {
        raw = fs.readFileSync(path.join(workspaceDir(tenant, workspace), "flows", f.file), "utf8");
      } catch {
        /* the canvas starts from the parsed steps alone */
      }
      const self = `${base}?flow=${encodeURIComponent(f.name)}`;
      const editHref = `/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${tenantParam}`;
      const callers = flows.filter((x) => x.steps.some((s) => s.subflow === f.name)).map((x) => x.name);
      const compute = f.compute ? [f.compute.vcpu !== undefined ? `${f.compute.vcpu} vCPU` : null, f.compute.memGiB !== undefined ? `${f.compute.memGiB} GiB` : null, f.compute.diskGiB !== undefined ? `${f.compute.diskGiB} GiB disk` : null].filter(Boolean).join(" · ") : null;

      return (
        <Page width="full">
          <PageHeader
            back={{ href: `${base}${qs}`, label: "Flows" }}
            icon={
              <IconBox className="size-10">
                <Workflow />
              </IconBox>
            }
            title={f.name}
            badge={
              <>
                <Tag>{triggerWord(f.trigger)}</Tag>
                {last ? <Status outcome={last.outcome} /> : <span className="text-sm text-fg-muted">never ran</span>}
              </>
            }
            description={triggerLine(f)}
            meta={
              <>
                <Fact label="Steps">{f.steps.length}</Fact>
                {row?.nextFireAt && <Fact label="Next run">{fmtIn(Date.parse(row.nextFireAt) - now)}</Fact>}
                {preview && (
                  <Tooltip label={costTitle(preview)}>
                    <span>
                      <Fact label="Usual cost">
                        {preview.cost}
                        {preview.time ? ` · ${preview.time}` : ""}
                      </Fact>
                    </span>
                  </Tooltip>
                )}
                {f.model && <Fact label="Model">{f.model}</Fact>}
                {f.a2a?.publish && <Fact label="A2A">{f.a2a.publicCard ? "published · public card" : "published"}</Fact>}
              </>
            }
            actions={
              <>
                <Link href={editHref} className={buttonVariants({ variant: "secondary" })}>
                  <FilePen aria-hidden />
                  Edit
                </Link>
                <FlowMoreMenu workspace={workspace} tenant={tenant} flow={f.name} file={f.file} deleteHref={`${self}&tab=settings${tenantParam}#delete`} />
                <RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label="Run flow" />
              </>
            }
          />
          <PageTabs
            tabs={[
              { label: "Steps", href: `${self}${tenantParam}`, active: tab === "steps", badge: warnings.length || undefined },
              { label: "Runs", href: `${self}&tab=runs${tenantParam}`, active: tab === "runs", badge: own.length || undefined },
              { label: "Settings", href: `${self}&tab=settings${tenantParam}`, active: tab === "settings" },
            ]}
          />

          {tab === "steps" && (
            <div className="space-y-6">
              {warnings.length > 0 && (
                <Panel title="Checks" description={`${plural(warnings.length, errors ? "problem" : "warning")} from foldrun check — each is also drawn on the step it is about.`} flush>
                  <PanelList>
                    {warnings.map((w, i) => (
                      <li key={i} className="flex min-w-0 gap-3 px-5 py-3">
                        {w.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="error" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="warning" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">{w.message}</p>
                          <p className="mt-0.5 text-sm text-fg-muted">{w.detail}</p>
                        </div>
                      </li>
                    ))}
                  </PanelList>
                </Panel>
              )}
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
                    // The same warnings the Checks panel lists, placed on
                    // the step they are about.
                    warnings={warnings.map((w) => ({ step: w.step, message: w.message, level: w.level }))}
                    usedBy={usedBy}
                    // The file itself (copy slices it, undo starts from it)
                    // and the recent runs, cut down to what the run overlay
                    // draws.
                    raw={raw}
                    runs={history.map(liteRun)}
                  />
                }
                list={
                  // Remount when the flow's shape changes, so the board's
                  // step indices never outlive the steps they point at.
                  <FlowBoard
                    name={f.name}
                    usedBy={usedBy}
                    key={f.steps.map((s) => `${s.group}:${s.subflow ?? s.agent}`).join("|")}
                    workspace={workspace}
                    tenant={tenant}
                    flow={f.name}
                    file={f.file}
                    steps={f.steps}
                    raw={raw}
                    knownAgents={agents.map((a) => a.name)}
                    knownFlows={flowNames}
                  />
                }
              />
            </div>
          )}

          {tab === "runs" &&
            (own.length === 0 ? (
              <EmptyState
                icon={<Workflow />}
                title="This flow has not run yet"
                description="Run it here, from the CLI or the API, or let its trigger start it. Every run appears here with the line it ended on."
                action={<RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label="Run flow" />}
              />
            ) : (
              <div className="max-w-5xl space-y-3">
                <div className="overflow-hidden rounded-lg border border-line bg-surface">
                  <ul className="divide-y divide-line">
                    {own.slice(0, 25).map((r) => {
                      const ms = r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null;
                      return (
                        <li key={r.id} className="relative flex min-w-0 items-center gap-4 px-4 py-3 hover:bg-sunken">
                          <Status outcome={r.outcome} className="w-28 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <Link href={`/dashboard/${workspace}/runs/${r.id}${qs}`} className="block truncate text-sm font-medium text-fg after:absolute after:inset-0">
                              {r.failure ? `${r.failure.agent}: ${r.failure.reason}` : (r.headline ?? <span className="text-fg-subtle">{OUTCOME[r.outcome].hint}</span>)}
                            </Link>
                            <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{r.id}</p>
                          </div>
                          <span className="hidden w-16 shrink-0 text-right text-sm tabular-nums text-fg-muted sm:block">{ms != null ? fmtSpan(ms) : "—"}</span>
                          <span className="hidden w-20 shrink-0 text-right text-sm tabular-nums text-fg-muted md:block">{r.costUsd ? creditsShort(r.costUsd) : "—"}</span>
                          <LocalTime iso={r.startedAt} options={{ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }} className="w-28 shrink-0 text-right text-sm tabular-nums text-fg-muted" />
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
                  <span>{own.length > 25 ? `The newest 25 of ${own.length}` : plural(own.length, "run")}</span>
                  <Link href={`/dashboard/${workspace}/runs?flow=${encodeURIComponent(f.name)}${tenantParam}`} className={buttonVariants({ variant: "secondary" })}>
                    All runs of {f.name}
                  </Link>
                </div>
              </div>
            ))}

          {tab === "settings" && (
            <div className="max-w-3xl">
              <SettingsCard
                title="Trigger"
                description={
                  <>
                    {triggerLine(f)}. Kept as <span className="font-mono">trigger:</span>
                    {f.schedule ? (
                      <>
                        {" "}and <span className="font-mono">schedule: {f.schedule}</span>
                      </>
                    ) : null}{" "}
                    in the flow file.
                  </>
                }
                hint={f.trigger === "webhook" || f.trigger === "email" || f.trigger === "storage" ? <Link href={`/dashboard/${workspace}/triggers${qs}`} className="text-link hover:underline">What fired, and what was held back</Link> : "Saved to the flow file at once."}
              >
                <TriggerEditor workspace={workspace} flow={f.name} trigger={f.trigger ?? "manual"} schedule={f.schedule} timezone={f.timezone} />
              </SettingsCard>
              <SettingsCard
                title="Outside agents (A2A)"
                description={f.a2a?.publish ? `Published${f.a2a.publicCard ? ", with a public card" : ""}: an outside agent with an A2A key naming this flow may call it.` : "Not published. Publishing lets another company's agent call this flow over A2A 1.0, with an A2A key that names it."}
                hint={<Link href={`/dashboard/${workspace}/triggers?tab=a2a${tenantParam}`} className="text-link hover:underline">Keys and recent tasks</Link>}
              >
                <A2aPublish workspace={workspace} tenant={tenant} flow={f.name} initial={f.a2a ?? null} />
              </SettingsCard>
              {/* Each run's own pool (27 Oct 2026): what one run of this flow may hold at once. */}
              <div className="mb-6">
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
              <SettingsCard
                title="Definition"
                description={
                  <>
                    The flow is <span className="font-mono">flows/{f.file}</span>: frontmatter, then the numbered steps.
                    {compute ? ` Each run may hold ${compute}.` : ""}
                  </>
                }
                hint="Changes take effect on the next run."
                footer={
                  <Link href={editHref} className={buttonVariants({ variant: "primary" })}>
                    Edit flows/{f.file}
                  </Link>
                }
              />
              <SettingsCard
                title="Export"
                description="The flow as a .zip — the flow file and the agents, tools and skills it needs — to import into another workspace or account."
                footer={<ExportLink workspace={workspace} kind="flow" name={f.name} label="Export .zip" className={buttonVariants({ variant: "secondary" })} />}
              />
              <SettingsCard
                id="delete"
                danger
                title="Delete flow"
                description={callers.length ? `Deleting it breaks ${callers.length === 1 ? "the flow" : "the flows"} that run it as a step: ${callers.join(", ")}.` : "Its file is removed from the workspace. Its runs stay on record."}
                footer={
                  <DeleteButton
                variant="button"
                    endpoint={`/api/workspaces/${workspace}/source`}
                    tenant={tenant}
                    body={{ path: `flows/${f.file}` }}
                    confirmText={`Delete flow ${f.name}?`}
                    redirectTo={`${base}${qs}`}
                  />
                }
              />
            </div>
          )}
        </Page>
      );
    }
  }

  // ---------- the list ----------

  const listRows: Row[] = flows.map((f) => {
    const href = flowHref(f.name);
    const beat = strips.get(f.name);
    const last = beat?.last ?? null;
    const row = rows.get(f.name);
    const line = triggerLine(f);
    const warnings = warningsFor(f);
    const errors = warnings.filter((w) => w.level === "error").length;
    const warns = warnings.length - errors;
    const preview = previewFor(f.name);
    const problems = errors ? plural(errors, "error") : warns ? plural(warns, "warning") : null;
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
    return {
      key: f.name,
      search: [f.name, f.file, f.trigger, f.schedule ?? "", line, ...f.steps.map((s) => s.subflow ?? s.agent)].join(" "),
      href,
      icon: <Workflow />,
      name: f.name,
      sub: (
        <>
          {line} · {plural(f.steps.length, "step")}
          {problems && <span className={errors ? "text-danger" : "text-warning"}> · {problems}</span>}
        </>
      ),
      cells: {
        status: last ? <Status outcome={last.outcome} /> : <span className="text-fg-muted">Never ran</span>,
        runs: beat && beat.cells.length ? <Cells beat={beat} n={12} tenant={tenant} /> : undefined,
        next: row?.nextFireAt ? fmtIn(Date.parse(row.nextFireAt) - now) : undefined,
        cost: preview ? <Tooltip label={costTitle(preview)}><span>{preview.cost}</span></Tooltip> : undefined,
      },
      action: <RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label="Run" />,
      card: (
        <ResourceCard
          href={href}
          icon={<Workflow />}
          name={f.name}
          sub={line}
          status={row && row.live > 0 ? "busy" : outcomeRing(last?.outcome)}
          statusLabel={row && row.live > 0 ? `${row.live} running` : last ? OUTCOME[last.outcome].hint : "never ran"}
          lines={[
            lastLine,
            ...(row?.nextFireAt ? [<><Clock3 /><span className="truncate">Next {fmtIn(Date.parse(row.nextFireAt) - now)}</span></>] : []),
            <><Layers /><span className="truncate">{plural(f.steps.length, "step")}{preview ? ` · usually ${preview.cost}` : ""}</span></>,
            ...(problems ? [<><AlertTriangle /><span className={errors ? "truncate text-danger" : "truncate text-warning"}>{problems}</span></>] : []),
          ]}
        />
      ),
    };
  });

  return (
    <Page>
      <FlowHashRedirect flows={flows.map((f) => ({ name: f.name, anchor: anchorId("flow", f.name) }))} query={tenantParam} />
      <PageHeader
        title="Flows"
        description="Which agents run, in what order, and where a person is asked."
        actions={
          <>
            <ImportPackageButton tenant={tenant} workspace={workspace} />
            <AskAiButton label="Draft with AI" prompt="Draft a flow that " title="Describe a flow; the assistant writes it and any agents it needs, checked, for you to save" />
            <NewFlowButton tenant={tenant} workspace={workspace} />
          </>
        }
      />
      <ResourceList
        id="flows"
        search="Search flows…"
        nameHeader="Flow"
        columns={[
          { key: "status", header: "Last run", hide: "sm" },
          { key: "runs", header: "Recent runs", hide: "lg" },
          { key: "next", header: "Next run", hide: "md" },
          { key: "cost", header: "Usual cost", align: "end", hide: "lg" },
        ]}
        rows={listRows}
        empty={
          <EmptyState
            icon={<Workflow />}
            title="No flows in this workspace yet"
            description="A flow is a numbered list of [[agent]] links under flows/. One agent per line; repeat a number to run those agents in parallel."
            action={
              <Link href={`${base}?create=flows${tenantParam}`} className={buttonVariants({ variant: "primary" })}>
                New flow
              </Link>
            }
          />
        }
      />
    </Page>
  );
}

/** New flow, with the shapes to start from. Examples, not types: every
 *  choice writes a plain flow file you then edit into whatever you need.
 *  The options that make these shapes work (loop:, each:, case:) are
 *  ordinary flow grammar, editable per step on the canvas. */
function NewFlowButton({ tenant, workspace }: { tenant: string; workspace: string }) {
  return (
    <CreateButton
      kind="flows"
      tenant={tenant}
      workspace={workspace}
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
  );
}
