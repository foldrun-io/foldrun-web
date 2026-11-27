// Flows — the other primary noun. A flow file is the orchestration: which
// agents run, in what order, what runs in parallel, and where a human is
// asked.
//
// Two views of one route: `/flows` is the list (what starts each flow, how
// its last runs went, when it fires next), and `/flows?flow=<name>` is one
// flow — its steps on the canvas, its runs and its settings, in tabs
// (`&tab=runs|settings`). `?create=flows` opens the New flow dialog.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
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
import { Page, PageHeader, IconBox, Tag, Fact, Panel, PanelList, SettingsCard, EmptyState, ResourceCard } from "@foldrun/ui/react/page";
import { ResourceList, type Row } from "@foldrun/ui/react/list";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { Status, StatusDot } from "@/components/status";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { AlertTriangle, CircleDashed, Clock3, FilePen, Layers, Workflow, XCircle } from "lucide-react";
import { FlowBoard } from "./flow-board";
import { FlowCanvas } from "./flow-canvas";
import { FlowView } from "./flow-view";
import { TriggerEditor } from "./trigger-editor";
import { FlowHashRedirect, FlowMoreMenu } from "./flow-actions";
import { triggerLine, triggerWord } from "./trigger-line";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

export default async function FlowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; flow?: string; tab?: string }>;
}) {
  await requestLocale();
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
      time: mins.length === 0 ? null : mins[mins.length - 1] <= mins[0] * 1.5 ? $t("workspace.flows-page.min", { v0: String(time(mins[0])) }) : $t("workspace.flows-page.min2", { v0: String(time(mins[0])), v1: String(time(mins[mins.length - 1])) }),
    };
  };
  const costTitle = (p: { n: number }) => $t("workspace.flows-page.fromTheLastWhatARun", { v0: String($t("workspace.flows-page.nCompletedRuns", { n: p.n })) });

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
          <PageHeader back={{ href: `${base}${qs}`, label: $t("workspace.flows-page.flows") }} title={chosen} />
          <EmptyState
            icon={<Workflow />}
            title={$t("workspace.flows-page.noFlowByThatName")}
            description={$t("workspace.flows-page.itMayHaveBeenRenamedOr")}
            action={
              <Link href={`${base}${qs}`} className={buttonVariants({ variant: "secondary" })}>
                {$t("workspace.flows-page.allFlows")}
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
      const compute = f.compute ? [f.compute.vcpu !== undefined ? `${f.compute.vcpu} vCPU` : null, f.compute.memGiB !== undefined ? `${f.compute.memGiB} GiB` : null, f.compute.diskGiB !== undefined ? $t("workspace.flows-page.gibDisk", { diskGiB: String(f.compute.diskGiB) }) : null].filter(Boolean).join(" · ") : null;

      return (
        <Page width="full">
          <PageHeader
            back={{ href: `${base}${qs}`, label: $t("workspace.flows-page.flows") }}
            icon={
              <IconBox className="size-10">
                <Workflow />
              </IconBox>
            }
            title={f.name}
            badge={
              <>
                <Tag>{triggerWord(f.trigger)}</Tag>
                {last ? <Status outcome={last.outcome} /> : <span className="text-sm text-fg-muted">{$t("workspace.flows-page.neverRan")}</span>}
              </>
            }
            description={triggerLine(f)}
            meta={
              <>
                <Fact label={$t("workspace.flows-page.steps")}>{f.steps.length}</Fact>
                {row?.nextFireAt && <Fact label={$t("workspace.flows-page.nextRun")}>{fmtIn(Date.parse(row.nextFireAt) - now)}</Fact>}
                {preview && (
                  <Tooltip label={costTitle(preview)}>
                    <span>
                      <Fact label={$t("workspace.flows-page.usualCost")}>
                        {preview.cost}
                        {preview.time ? ` · ${preview.time}` : ""}
                      </Fact>
                    </span>
                  </Tooltip>
                )}
                {f.model && <Fact label={$t("workspace.flows-page.model")}>{f.model}</Fact>}
                {f.a2a?.publish && <Fact label="A2A">{f.a2a.publicCard ? $t("workspace.flows-page.publishedPublicCard") : "published"}</Fact>}
              </>
            }
            actions={
              <>
                <Link href={editHref} className={buttonVariants({ variant: "secondary" })}>
                  <FilePen aria-hidden />
                  {$t("workspace.flows-page.edit")}
                </Link>
                <FlowMoreMenu workspace={workspace} tenant={tenant} flow={f.name} file={f.file} deleteHref={`${self}&tab=settings${tenantParam}#delete`} />
                <RunButton endpoint={`/v1/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label={$t("workspace.flows-page.runFlow")} />
              </>
            }
          />
          <PageTabs
            tabs={[
              { label: $t("workspace.flows-page.steps"), href: `${self}${tenantParam}`, active: tab === "steps", badge: warnings.length || undefined },
              { label: $t("workspace.flows-page.runs"), href: `${self}&tab=runs${tenantParam}`, active: tab === "runs", badge: own.length || undefined },
              { label: $t("workspace.flows-page.settings"), href: `${self}&tab=settings${tenantParam}`, active: tab === "settings" },
            ]}
          />

          {tab === "steps" && (
            <div className="space-y-6">
              {warnings.length > 0 && (
                <Panel title={$t("workspace.flows-page.checks")} description={$t("workspace.flows-page.checkFindings", { n: warnings.length, kind: errors ? "problem" : "warning" })} flush>
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
                title={$t("workspace.flows-page.thisFlowHasNotRunYet")}
                description={$t("workspace.flows-page.runItHereFromTheCli")}
                action={<RunButton endpoint={`/v1/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label={$t("workspace.flows-page.runFlow")} />}
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
                  <span>{own.length > 25 ? $t("workspace.flows-page.theNewest25Of", { length: String(own.length) }) : $t("workspace.flows-page.nRuns", { n: own.length })}</span>
                  <Link href={`/dashboard/${workspace}/runs?flow=${encodeURIComponent(f.name)}${tenantParam}`} className={buttonVariants({ variant: "secondary" })}>
                    {$t("workspace.flows-page.allRunsOf", { name: f.name })}
                  </Link>
                </div>
              </div>
            ))}

          {tab === "settings" && (
            <div className="max-w-3xl">
              <SettingsCard
                title={$t("workspace.flows-page.trigger")}
                description={
                  <>
                    {$rich("workspace.flows-page.keptAsTriggerInFile", { f: triggerLine(f), scheduled: f.schedule ? "yes" : "no", schedule: f.schedule ?? "", span: (chunks) => <span className="font-mono">{chunks}</span> })}
                  </>
                }
                hint={f.trigger === "webhook" || f.trigger === "email" || f.trigger === "storage" ? <Link href={`/dashboard/${workspace}/triggers${qs}`} className="text-link hover:underline">{$t("workspace.flows-page.whatFiredAndWhatWasHeld")}</Link> : $t("workspace.flows-page.savedToTheFlowFileAt")}
              >
                <TriggerEditor workspace={workspace} flow={f.name} trigger={f.trigger ?? "manual"} schedule={f.schedule} timezone={f.timezone} />
              </SettingsCard>
              <SettingsCard
                title={$t("workspace.flows-page.outsideAgentsA2a")}
                description={f.a2a?.publish ? $t("workspace.flows-page.publishedAnOutsideAgentWithAn", { v0: String(f.a2a.publicCard ? $t("workspace.flows-page.withAPublicCard") : "") }) : $t("workspace.flows-page.notPublishedPublishingLetsAnotherCompany")}
                hint={<Link href={`/dashboard/${workspace}/triggers?tab=a2a${tenantParam}`} className="text-link hover:underline">{$t("workspace.flows-page.keysAndRecentTasks")}</Link>}
              >
                <A2aPublish workspace={workspace} tenant={tenant} flow={f.name} initial={f.a2a ?? null} />
              </SettingsCard>
              {/* Each run's own pool (27 Oct 2026): what one run of this flow may hold at once. */}
              <div className="mb-6">
                <ComputeCard
                  endpoint={`/v1/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(f.name)}`}
                  tenant={tenant}
                  level="flow"
                  initial={f.compute ? { vcpu: f.compute.vcpu ?? null, memGiB: f.compute.memGiB ?? null, diskGiB: f.compute.diskGiB ?? null } : null}
                  pool={{ vcpu: f.compute?.vcpu ?? null, memGiB: f.compute?.memGiB ?? null, diskGiB: f.compute?.diskGiB ?? null }}
                  // The cap is each run's: shown against its busiest live run, never a sum of several.
                  inUse={held.runs.filter((r) => r.flow === f.name).map((r) => r.inUse).reduce((a, r) => (r.vcpu + r.memGiB + r.diskGiB > a.vcpu + a.memGiB + a.diskGiB ? r : a), { vcpu: 0, memGiB: 0, diskGiB: 0, steps: 0 })}
                />
              </div>
              <SettingsCard
                title={$t("workspace.flows-page.definition")}
                description={
                  <>
                    {$rich("workspace.flows-page.theFlowIsFlowsFrontmatterThen", { file: f.file, span: (chunks) => <span className="font-mono">{chunks}</span> })}
                    {compute ? $t("workspace.flows-page.eachRunMayHold", { compute: String(compute) }) : ""}
                  </>
                }
                hint={$t("workspace.flows-page.changesTakeEffectOnTheNext")}
                footer={
                  <Link href={editHref} className={buttonVariants({ variant: "primary" })}>
                    {$t("workspace.flows-page.editFlows", { file: f.file })}
                  </Link>
                }
              />
              <SettingsCard
                title={$t("workspace.flows-page.export")}
                description={$t("workspace.flows-page.theFlowAsAZipThe")}
                footer={<ExportLink workspace={workspace} kind="flow" name={f.name} label={$t("workspace.flows-page.exportZip")} className={buttonVariants({ variant: "secondary" })} />}
              />
              <SettingsCard
                id="delete"
                danger
                title={$t("workspace.flows-page.deleteFlow")}
                description={callers.length ? $t("workspace.flows-page.deletingItBreaksThatRunIt", { v0: String(callers.length === 1 ? $t("workspace.flows-page.theFlow") : $t("workspace.flows-page.theFlows")), v1: String(callers.join(", ")) }) : $t("workspace.flows-page.itsFileIsRemovedFromThe")}
                footer={
                  <DeleteButton
                variant="button"
                    endpoint={`/v1/workspaces/${workspace}/source`}
                    tenant={tenant}
                    body={{ path: `flows/${f.file}` }}
                    confirmText={$t("workspace.flows-page.deleteFlow2", { name: String(f.name) })}
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
    const problems = errors ? $t("workspace.flows-page.nErrors", { n: errors }) : warns ? $t("workspace.flows-page.nWarnings", { n: warns }) : null;
    const lastLine = last ? (
      <>
        <StatusDot outcome={last.outcome} label="" />
        <span className="truncate">
          {$t("workspace.flows-page.ago", { label: OUTCOME[last.outcome].label, fmtSpan: fmtSpan(now - Date.parse(last.startedAt)) })}
          {last.failure ? ` · ${last.failure.agent}: ${last.failure.reason}` : last.headline ? ` · ${last.headline}` : ""}
        </span>
      </>
    ) : (
      <>
        <CircleDashed />
        <span className="truncate">{$t("workspace.flows-page.neverRan2")}</span>
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
          {line} · {$t("workspace.flows-page.nSteps", { n: f.steps.length })}
          {problems && <span className={errors ? "text-danger" : "text-warning"}> · {problems}</span>}
        </>
      ),
      cells: {
        status: last ? <Status outcome={last.outcome} /> : <span className="text-fg-muted">{$t("workspace.flows-page.neverRan2")}</span>,
        runs: beat && beat.cells.length ? <Cells beat={beat} n={12} tenant={tenant} /> : undefined,
        next: row?.nextFireAt ? fmtIn(Date.parse(row.nextFireAt) - now) : undefined,
        cost: preview ? <Tooltip label={costTitle(preview)}><span>{preview.cost}</span></Tooltip> : undefined,
      },
      action: <RunButton endpoint={`/v1/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label={$t("workspace.flows-page.run")} />,
      card: (
        <ResourceCard
          href={href}
          icon={<Workflow />}
          name={f.name}
          sub={line}
          status={row && row.live > 0 ? "busy" : outcomeRing(last?.outcome)}
          statusLabel={row && row.live > 0 ? `${row.live} running` : last ? OUTCOME[last.outcome].hint : $t("workspace.flows-page.neverRan")}
          lines={[
            lastLine,
            ...(row?.nextFireAt ? [<><Clock3 /><span className="truncate">{$t("workspace.flows-page.next", { fmtIn: fmtIn(Date.parse(row.nextFireAt) - now) })}</span></>] : []),
            <><Layers /><span className="truncate">{$t("workspace.flows-page.nSteps", { n: f.steps.length })}{preview ? $t("workspace.flows-page.usually", { cost: String(preview.cost) }) : ""}</span></>,
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
        title={$t("workspace.flows-page.flows")}
        description={$t("workspace.flows-page.whichAgentsRunInWhatOrder")}
        actions={
          <>
            <ImportPackageButton tenant={tenant} workspace={workspace} />
            <AskAiButton label={$t("workspace.flows-page.draftWithAi")} prompt={$t("workspace.flows-page.draftAFlowThat")} title={$t("workspace.flows-page.describeAFlowTheAssistantWrites")} />
            <NewFlowButton tenant={tenant} workspace={workspace} />
          </>
        }
      />
      <ResourceList
        id="flows"
        search={$t("workspace.flows-page.searchFlows")}
        nameHeader="Flow"
        columns={[
          { key: "status", header: $t("workspace.flows-page.lastRun"), hide: "sm" },
          { key: "runs", header: $t("workspace.flows-page.recentRuns"), hide: "lg" },
          { key: "next", header: $t("workspace.flows-page.nextRun"), hide: "md" },
          { key: "cost", header: $t("workspace.flows-page.usualCost"), align: "end", hide: "lg" },
        ]}
        rows={listRows}
        empty={
          <EmptyState
            icon={<Workflow />}
            title={$t("workspace.flows-page.noFlowsInThisWorkspaceYet")}
            description={$t("workspace.flows-page.aFlowIsANumberedList")}
            action={
              <Link href={`${base}?create=flows${tenantParam}`} className={buttonVariants({ variant: "primary" })}>
                {$t("workspace.flows-page.newFlow")}
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
          { value: "pipeline", label: $t("workspace.flows-page.basicFlow"), hint: $t("workspace.flows-page.stepsInOrderOneAgentEach"), section: $t("workspace.flows-page.startFromScratch") },
          { value: "review-loop", label: $t("workspace.flows-page.reviewLoop"), hint: $t("workspace.flows-page.aMakerAndACheckerThe"), section: $t("workspace.flows-page.startFromAnExample") },
          { value: "fan-out", label: $t("workspace.flows-page.fanOut"), hint: $t("workspace.flows-page.oneStepRunsOncePerLine"), section: $t("workspace.flows-page.startFromAnExample") },
          { value: "debate", label: $t("workspace.flows-page.debate"), hint: $t("workspace.flows-page.twoAgentsTakePositionsAThird"), section: $t("workspace.flows-page.startFromAnExample") },
          { value: "router", label: $t("workspace.flows-page.router"), hint: $t("workspace.flows-page.aTriageStepWhoseVerdictPicks"), section: $t("workspace.flows-page.startFromAnExample") },
        ],
      }}
    />
  );
}
