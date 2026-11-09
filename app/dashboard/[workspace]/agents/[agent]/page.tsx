// One agent, and everything it has actually done.
//
// The runs list is keyed by flow, which answers "did Monday's flow finish".
// It cannot answer "is this agent any good" — an agent that appears in four
// flows has its work spread across four filters, and one that runs on its own
// is only findable by knowing the `adhoc:` prefix. This is the other axis:
// what it is allowed to do at the top, what it has produced underneath.

import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import { Pager } from "@foldrun/ui/react/pager";
import { paginate, pageFrom, PAGE_SIZE } from "@foldrun/ui/react/paging";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listAgentSteps, agentAssets, listFlows } from "@/lib/store";
import { Email } from "@/components/email";
import { ExportLink } from "@/components/package-buttons";
import { LocalTime } from "@/components/local-time";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { readNetwork, TRUSTED_SITES } from "@/lib/network";
import { AgentNetwork } from "./agent-network";
import { browseVerdict, vendorDoorFor } from "@/lib/browse-egress";
import { confinesBrowsing, wallsRestrictedSteps } from "@/platform/browse-confine";
import { searchDoorWanted } from "@/lib/search-egress";
import { DOOR_CATEGORIES } from "@/platform/search-door";
import { dnsWallEnabled } from "@/platform/run-dns";
import { Bot, FilePen } from "lucide-react";
import { Page, PageHeader, IconBox, Tag, Chip, Panel, SummaryCard, FactRow, SettingsCard, EmptyState } from "@foldrun/ui/react/page";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { Status } from "@/components/status";
import { buttonVariants } from "@foldrun/ui/react/button";
import type { Outcome } from "@/components/outcome-model";
import { RunButton } from "../../../run-button";
import { DeleteButton } from "../../../manage";

export const dynamic = "force-dynamic";

const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

// Times go through LocalTime, never toLocaleString here: this is a server
// component, so formatting on the box would show every viewer the box's clock
// rather than the zone they chose on their profile.
const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

// A step's status, drawn with the outcome dot that means the same.
const STEP_OUTCOME: Record<string, Outcome> = {
  completed: "done",
  failed: "failed",
  "awaiting-approval": "waiting",
  running: "running",
  skipped: "quiet",
  pending: "queued",
  stopped: "stopped",
};

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; agent: string }>;
  searchParams: Promise<{ tenant?: string; page?: string; tab?: string }>;
}) {
  const { workspace, agent } = await params;
  const { tenant = "default", page: pageParam, tab = "overview" } = await searchParams;
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
  // Whether a browsing step of this agent is held to that list here (FOL-110
  // phase 3): the folder's half from listAgents, the install's switches from
  // this server's environment — the same rule the runner applies per step.
  const n = info.network;
  const browse = n.browses
    ? browseVerdict({
        level: n.level,
        enforce: n.enforceWanted || process.env.FOLDRUN_NETWORK_ENFORCE === "1",
        vendor: n.browseVendor,
        confines: confinesBrowsing(process.env.FOLDRUN_RUN_ISOLATION ?? ""),
        // FOL-145: a vendor this install holds through its vendor door.
        door: !!vendorDoorFor(n.browseVendor),
      }).kind
    : null;
  // How its web search goes when a step is walled to its list (FOL-128):
  // through the egress proxy's search door, or not offered — the runner's
  // own rule (core search-egress.ts), with this server's switches. Null when
  // no step of it is walled here, or it does not search our engine.
  const enforce = n.enforceWanted || process.env.FOLDRUN_NETWORK_ENFORCE === "1";
  const searchDoor =
    // A browsing step is walled only when browsing is confined (the runner
    // gives it the forward door only then).
    n.level !== "open" && enforce && wallsRestrictedSteps(process.env.FOLDRUN_RUN_ISOLATION ?? "") && (!n.browses || browse === "hosted")
      ? searchDoorWanted({ level: n.level, defaults: n.defaults, enforce, web: n.search.web, actions: n.search.actions, provided: n.search.provided })
      : null;
  const search = !searchDoor || (!searchDoor.door && !searchDoor.line) ? null : searchDoor.door ? "door" : "unnamed";
  const searchEngines = Object.values(DOOR_CATEGORIES).flat();
  const spend = steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const failed = steps.filter((s) => s.stepStatus === "failed").length;

  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}/agents/${encodeURIComponent(agent)}`;
  const editHref = `/dashboard/${workspace}/edit?path=${encodeURIComponent(`agents/${agent}/agent.md`)}${amp}`;
  const lastStep = steps[0];

  return (
    <Page>
      <PageHeader
        back={{ href: `/dashboard/${workspace}/agents${qs}`, label: "Agents" }}
        icon={
          <IconBox className="size-10">
            <Bot />
          </IconBox>
        }
        title={agent}
        badge={
          <>
            <Tag mono>{info.model}</Tag>
            {lastStep ? <Status outcome={STEP_OUTCOME[lastStep.stepStatus] ?? "quiet"} label={lastStep.stepStatus} /> : <span className="text-sm text-fg-muted">never ran</span>}
          </>
        }
        description={info.description || "No description"}
        actions={
          <>
            <Link href={editHref} className={buttonVariants({ variant: "secondary" })}>
              <FilePen aria-hidden />
              Edit agent.md
            </Link>
            <RunButton endpoint={`/api/workspaces/${workspace}/agents/${agent}/run`} tenant={tenant} label="Run" withTask={false} />
          </>
        }
      />
      <PageTabs
        tabs={[
          { label: "Overview", href: `${base}${qs}`, active: tab === "overview" },
          { label: "Activity", href: `${base}?tab=activity${amp}`, active: tab === "activity", badge: steps.length || undefined },
          { label: "Settings", href: `${base}?tab=settings${amp}`, active: tab === "settings" },
        ]}
      />

      {tab === "overview" && (
        <div className="space-y-8">
          <SummaryCard
            items={[
              { label: "Model", value: <span className="font-mono">{info.model}</span> },
              { label: "Owner", value: info.owner ? <><Email value={info.owner} />{info.ownerFrom !== "agent" && <span className="text-fg-muted"> · from the {info.ownerFrom}</span>}</> : "none" },
              { label: "Called by", value: callers.length ? callers.join(", ") : "no flow" },
              { label: "Steps on record", value: steps.length },
              { label: "Failed", value: failed },
              { label: "Spend", value: money(spend) },
            ]}
          />
          <Panel title="What it may do" description="Its frontmatter is the whole contract: the model, the tools and APIs it holds, who it may consult, the secrets it reads.">
            <div className="flex flex-wrap gap-1.5">
              {info.effort ? <Chip>effort {info.effort}</Chip> : null}
              {info.maxOutputTokens ? <Chip>longest reply {info.maxOutputTokens} tokens</Chip> : null}
              {info.tools.length ? info.tools.map((t) => <Chip key={t}>{t}</Chip>) : <Chip>no tools</Chip>}
              {info.apis.map((a) => <Chip key={a.name} tone="info">{a.name}</Chip>)}
              {info.consults.map((c) => <Chip key={c} tone="info">consults {c}</Chip>)}
              {(info.subagents ?? []).map((c) => <Chip key={`sub-${c}`} tone="info">delegates to {c}</Chip>)}
              {info.secrets.map((s) => <Chip key={s} tone="warn">{s}</Chip>)}
            </div>
            <FactRow
              className="mt-5 border-t border-line pt-4"
              items={[
                { label: "Own skills", value: assets.skills.length },
                { label: "Own memory", value: assets.memory.length },
                { label: "Skills", value: info.skills === null ? "every skill in scope" : info.skills.join(", ") || "none" },
              ]}
            />
          </Panel>
          <AgentNetwork
            tenant={tenant}
            workspace={workspace}
            agent={agent}
            own={ownNetwork}
            resolved={info.network}
            browse={browse}
            dnsWalled={dnsWallEnabled()}
            search={search}
            searchEngines={searchEngines}
            trustedCount={TRUSTED_SITES.length}
            editable
          />
        </div>
      )}

      {tab === "activity" &&
        (steps.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title="This agent has not run yet"
            description="Run it here, or from a flow that steps through it. Every step it runs appears here with the line it opened its reply with."
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <ul className="divide-y divide-line">
                {activity.rows.map((s, i) => (
                  <li key={`${s.runId}:${i}`} className="relative flex min-w-0 items-center gap-4 px-4 py-3 hover:bg-sunken">
                    <Status outcome={STEP_OUTCOME[s.stepStatus] ?? "quiet"} label={s.stepStatus} className="w-28 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/${workspace}/runs/${s.runId}${qs}`} className="block truncate text-sm font-medium text-fg after:absolute after:inset-0">
                        {/* The step's OWN first line, not the run's summary. */}
                        {s.headline ?? <span className="text-fg-subtle">no reply recorded</span>}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                        <span>{s.flow.startsWith("adhoc:") ? "run directly" : s.flow}</span>
                        {s.item ? <span className="truncate">on {s.item}</span> : null}
                        {s.denied ? <span className="text-warning">{s.denied} path{s.denied === 1 ? "" : "s"} refused</span> : null}
                      </p>
                    </div>
                    <span className="hidden shrink-0 text-sm tabular-nums text-fg-muted sm:block">{s.costUsd ? money(s.costUsd) : "—"}</span>
                    <LocalTime iso={s.startedAt} options={WHEN} className="w-28 shrink-0 text-right text-sm tabular-nums text-fg-muted" />
                  </li>
                ))}
              </ul>
            </div>
            <Pager base={base} page={activity.page} pages={activity.pages} total={activity.total} pageSize={PAGE_SIZE} tenantParam={`&tab=activity${amp}`} labels={["Newer", "Older"]} />
          </>
        ))}

      {tab === "settings" && (
        <div className="max-w-3xl">
          <SettingsCard
            title="Definition"
            description={<>The agent is <span className="font-mono">agents/{agent}/agent.md</span>: frontmatter, then the prose that is its system prompt.</>}
            hint="Changes take effect on the next step that runs it."
            footer={
              <Link href={editHref} className={buttonVariants({ variant: "primary" })}>
                Edit agent.md
              </Link>
            }
          />
          <SettingsCard
            title="Export"
            description="The agent's folder as a .zip — its agent.md, own skills, memory and tools — to import into another workspace or account."
            footer={<ExportLink workspace={workspace} kind="agent" name={agent} className={buttonVariants({ variant: "secondary" })} />}
          />
          <SettingsCard
            danger
            title="Delete agent"
            description={callers.length ? `Deleting it breaks ${callers.length === 1 ? "the flow" : "the flows"} that step through it: ${callers.join(", ")}.` : "Its folder is removed from the workspace. Runs it took part in stay on record."}
            footer={
              <DeleteButton
                variant="button"
                endpoint={`/api/workspaces/${workspace}/source`}
                tenant={tenant}
                body={{ path: `agents/${agent}` }}
                confirmText={`Delete agent ${agent}?${callers.length ? ` ${callers.join(", ")} will stop working.` : ""}`}
                redirectTo={`/dashboard/${workspace}/agents${qs}`}
              />
            }
          />
        </div>
      )}
    </Page>
  );
}
