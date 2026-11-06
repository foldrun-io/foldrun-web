// Agents — the primary noun. Previously agents were only reachable by
// scanning the Overview list, which put them below memory files in the
// navigation. A workspace is made of agents; they get their own page.

import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listFlows, agentAssets } from "@/lib/store";
import { agentsWithActivity, staleDaysOf } from "@/server/agent-activity";
import { fmtAgo, nowMs } from "@/components/overview-model";
import { CreateButton } from "@/components/create";
import { Email } from "@/components/email";
import { ImportAgentButton } from "./import-agent";
import { ImportPackageButton } from "@/components/package-buttons";
import { RunButton } from "../../run-button";
import { BookOpen, Bot, User, Workflow, Wrench } from "lucide-react";
import { Page, PageHeader, ResourceCard, EmptyState, Tag, Chip } from "@/components/kit/page";
import { ResourceList, type Row } from "@/components/kit/list";

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const agents = agentsWithActivity(tenant, workspace);
  const staleDays = staleDaysOf(tenant, workspace);
  const now = nowMs();
  const flows = listFlows(tenant, workspace);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  // Which flows call each agent — the question you actually have when looking
  // at an agent is "who orchestrates this?".
  const usedBy = new Map<string, string[]>();
  for (const flow of flows) {
    for (const step of flow.steps) {
      if (step.subflow) continue;
      const list = usedBy.get(step.agent) ?? [];
      if (!list.includes(flow.name)) list.push(flow.name);
      usedBy.set(step.agent, list);
    }
  }

  const rows: Row[] = agents.map((a) => {
    const assets = agentAssets(tenant, workspace, a.name);
    const callers = usedBy.get(a.name) ?? [];
    const href = `/dashboard/${workspace}/agents/${encodeURIComponent(a.name)}${qs}`;
    const ran = a.lastRunAt ? `ran ${fmtAgo(now - Date.parse(a.lastRunAt))}` : "never ran";
    const tools = a.tools.length ? a.tools.join(", ") : "no tools";
    return {
      key: a.name,
      search: [a.name, a.description, a.owner ?? "", a.model, ...a.tools, ...callers].join(" "),
      href,
      icon: <Bot />,
      name: a.name,
      sub: a.description || "No description",
      cells: {
        model: <Tag mono>{a.model}</Tag>,
        tools: <span title={tools}>{tools}</span>,
        flows: callers.length ? callers.join(", ") : <span className="text-fg-subtle">no flow</span>,
        last: a.stale ? <Chip tone="warn">not run in {staleDays}+ days</Chip> : <span title={a.lastRunAt ?? undefined}>{ran}</span>,
      },
      action: <RunButton endpoint={`/api/workspaces/${workspace}/agents/${a.name}/run`} tenant={tenant} label="Run" withTask={false} />,
      card: (
        <ResourceCard
          href={href}
          icon={<Bot />}
          name={a.name}
          sub={a.model}
          status={a.stale ? "idle" : a.lastRunAt ? "live" : "idle"}
          statusLabel={ran}
          lines={[
            <span key="d" className="truncate">{a.description || "No description"}</span>,
            <><Wrench /><span className="truncate">{tools}</span></>,
            <><Workflow /><span className="truncate">{callers.length ? `in ${callers.join(", ")}` : "in no flow"}</span></>,
            ...(assets.skills.length || assets.memory.length ? [<><BookOpen /><span className="truncate">{assets.skills.length} own skills · {assets.memory.length} memory</span></>] : []),
            ...(a.owner ? [<><User /><span className="truncate"><Email value={a.owner} /></span></>] : []),
          ]}
        />
      ),
    };
  });

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="One folder, one agent.md: its frontmatter is the whole contract — model, tools, secrets."
        actions={
          <>
            <ImportAgentButton tenant={tenant} workspace={workspace} />
            <ImportPackageButton tenant={tenant} workspace={workspace} label="Import .zip" />
            <CreateButton kind="agents" tenant={tenant} workspace={workspace} />
          </>
        }
      />
      <ResourceList
        id="agents"
        search="Search agents…"
        nameHeader="Agent"
        columns={[
          { key: "model", header: "Model", hide: "md" },
          { key: "tools", header: "Tools", hide: "lg" },
          { key: "flows", header: "Used by", hide: "lg" },
          { key: "last", header: "Last run", hide: "sm" },
        ]}
        rows={rows}
        empty={
          <EmptyState
            icon={<Bot />}
            title="No agents in this workspace yet"
            description="An agent is a folder under agents/ with an agent.md inside. Bring in one you already have from another workspace, create a new one, or push it with the CLI."
            action={
              <>
                {/* Only Import here: the header's New agent is always on the page,
                    and a second CreateButton would open a second dialog for
                    ?create=agents. */}
                <ImportAgentButton tenant={tenant} workspace={workspace} color="primary" />
              </>
            }
          />
        }
      />
    </Page>
  );
}
