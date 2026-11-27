// Agents — the primary noun. Previously agents were only reachable by
// scanning the Overview list, which put them below memory files in the
// navigation. A workspace is made of agents; they get their own page.

import { $t } from "@/i18n";
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
import { Page, PageHeader, ResourceCard, EmptyState, Tag, Chip } from "@foldrun/ui/react/page";
import { ResourceList, type Row } from "@foldrun/ui/react/list";
import { Tooltip } from "@foldrun/ui/react/tooltip";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  await requestLocale();
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
    const ran = a.lastRunAt ? `ran ${fmtAgo(now - Date.parse(a.lastRunAt))}` : $t("workspace.agents-page.neverRan");
    const tools = a.tools.length ? a.tools.join(", ") : $t("workspace.agents-page.noTools");
    return {
      key: a.name,
      search: [a.name, a.description, a.owner ?? "", a.model, ...a.tools, ...callers].join(" "),
      href,
      icon: <Bot />,
      name: a.name,
      sub: a.description || $t("workspace.agents-page.noDescription"),
      cells: {
        model: <Tag mono>{a.model}</Tag>,
        tools: <Tooltip label={tools}><span>{tools}</span></Tooltip>,
        flows: callers.length ? callers.join(", ") : <span className="text-fg-subtle">{$t("workspace.agents-page.noFlow")}</span>,
        last: a.stale ? <Chip tone="warn">{$t("workspace.agents-page.notRunInDays", { staleDays: String(staleDays ?? "") })}</Chip> : <Tooltip label={a.lastRunAt}><span>{ran}</span></Tooltip>,
      },
      action: <RunButton endpoint={`/v1/workspaces/${workspace}/agents/${a.name}/run`} tenant={tenant} label={$t("workspace.agents-page.run")} dialog />,
      card: (
        <ResourceCard
          href={href}
          icon={<Bot />}
          name={a.name}
          sub={a.model}
          status={a.stale ? "idle" : a.lastRunAt ? "live" : "idle"}
          statusLabel={ran}
          lines={[
            <span key="d" className="truncate">{a.description || $t("workspace.agents-page.noDescription")}</span>,
            <><Wrench /><span className="truncate">{tools}</span></>,
            <><Workflow /><span className="truncate">{callers.length ? `in ${callers.join(", ")}` : $t("workspace.agents-page.inNoFlow")}</span></>,
            ...(assets.skills.length || assets.memory.length ? [<><BookOpen /><span className="truncate">{$t("workspace.agents-page.ownSkillsMemory", { length: String(assets.skills.length), length2: String(assets.memory.length) })}</span></>] : []),
            ...(a.owner ? [<><User /><span className="truncate"><Email value={a.owner} /></span></>] : []),
          ]}
        />
      ),
    };
  });

  return (
    <Page>
      <PageHeader
        title={$t("workspace.agents-page.agents")}
        description={$t("workspace.agents-page.oneFolderOneAgentMdIts")}
        actions={
          <>
            <ImportAgentButton tenant={tenant} workspace={workspace} />
            <ImportPackageButton tenant={tenant} workspace={workspace} label={$t("workspace.agents-page.importZip")} />
            <CreateButton kind="agents" tenant={tenant} workspace={workspace} />
          </>
        }
      />
      <ResourceList
        id="agents"
        search={$t("workspace.agents-page.searchAgents")}
        nameHeader="Agent"
        columns={[
          { key: "model", header: $t("workspace.agents-page.model"), hide: "md" },
          { key: "tools", header: $t("workspace.agents-page.tools"), hide: "lg" },
          { key: "flows", header: $t("workspace.agents-page.usedBy"), hide: "lg" },
          { key: "last", header: $t("workspace.agents-page.lastRun"), hide: "sm" },
        ]}
        rows={rows}
        empty={
          <EmptyState
            icon={<Bot />}
            title={$t("workspace.agents-page.noAgentsInThisWorkspaceYet")}
            description={$t("workspace.agents-page.anAgentIsAFolderUnder")}
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
