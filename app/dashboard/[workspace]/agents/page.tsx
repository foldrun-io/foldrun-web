// Agents — the primary noun. Previously agents were only reachable by
// scanning the Overview list, which put them below memory files in the
// navigation. A workspace is made of agents; they get their own page.

import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace-header";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listFlows, agentAssets } from "@/lib/store";
import { agentsWithActivity, staleDaysOf } from "@/server/agent-activity";
import { fmtAgo, nowMs } from "@/components/overview-model";
import { CreateButton } from "@/components/create";
import { ListSearch } from "@/components/list-search";
import { Badge, Card, EmptyScreen, PageHeader } from "@/components/ui";
import { Email } from "@/components/email";
import { AgentRow } from "./agent-row";
import { ImportAgentButton } from "./import-agent";
import { ImportPackageButton } from "@/components/package-buttons";

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Agents"
        subtitle="One folder, one agent.md. Its frontmatter is the whole contract: model, granted tools, secrets."
      >
        <div className="flex items-center gap-2">
          <ImportAgentButton tenant={tenant} workspace={workspace} />
          <ImportPackageButton tenant={tenant} workspace={workspace} />
          <CreateButton kind="agents" tenant={tenant} workspace={workspace} />
        </div>
      </PageHeader>

      {agents.length === 0 ? (
        <EmptyScreen
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="12" rx="3" />
              <path d="M12 8V4M8 14h.01M16 14h.01" />
            </svg>
          }
          title="No agents in this workspace yet"
          description="An agent is a folder under agents/ with an agent.md inside. Bring in one you already have from another workspace, create a new one, or push it with the CLI."
        >
          <ImportAgentButton tenant={tenant} workspace={workspace} color="primary" />
        </EmptyScreen>
      ) : (
        <>
        <ListSearch listId="agents-list" placeholder="Search agents…" total={agents.length} noun="agents" />
        <Card>
          <ul id="agents-list" className="divide-y divide-line-faint">
            {agents.map((a) => {
              const assets = agentAssets(tenant, workspace, a.name);
              const callers = usedBy.get(a.name) ?? [];
              return (
                <AgentRow
                  key={a.name}
                  search={[a.name, a.description, a.owner ?? "", a.model, ...a.tools].join(" ")}
                  workspace={workspace}
                  tenant={tenant}
                  name={a.name}
                  description={a.description}
                  badges={
                    <>
                      <Badge variant="info">{a.model}</Badge>
                      {a.stale && <Badge variant="warning">not run in {staleDays}+ days</Badge>}
                      {a.tools.length > 0 ? (
                        a.tools.map((t) => <Badge key={t}>{t}</Badge>)
                      ) : (
                        <Badge>no tools</Badge>
                      )}
                      {a.apis.map((api) => (
                        <Badge key={api.name} variant="info">{api.name}</Badge>
                      ))}
                      {a.legacyUse.map((t) => (
                        <Badge key={t} variant="warning">use: {t} — not granted</Badge>
                      ))}
                      {a.secrets.map((s) => (
                        <Badge key={s} variant="warning">{s}</Badge>
                      ))}
                    </>
                  }
                  footer={
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {/* Who answers for it — its own owner:, else the
                          workspace's, else the account's. */}
                      <span>
                        <span className="text-fg-subtle">owner</span>{" "}
                        {a.owner ? (
                          <span className="font-medium text-fg-secondary" title={a.ownerFrom !== "agent" ? `from the ${a.ownerFrom}'s AGENTS.md` : undefined}>
                            <Email value={a.owner} />
                          </span>
                        ) : (
                          <span className="text-fg-subtle">none</span>
                        )}
                      </span>
                      <span>
                        <span className="text-fg-subtle">last run</span>{" "}
                        {a.lastRunAt ? (
                          <span title={a.lastRunAt}>{fmtAgo(now - Date.parse(a.lastRunAt))}</span>
                        ) : (
                          <span className="text-fg-subtle">never, in the runs kept</span>
                        )}
                      </span>
                      <span><span className="text-fg-subtle">own skills</span> {assets.skills.length}</span>
                      <span><span className="text-fg-subtle">own memory</span> {assets.memory.length}</span>
                      <span className="truncate">
                        <span className="text-fg-subtle">used by</span>{" "}
                        {callers.length === 0 ? (
                          <span className="text-fg-subtle">no flow</span>
                        ) : (
                          callers.map((f, i) => (
                            <span key={f}>
                              {i > 0 && ", "}
                              <Link
                                href={`/dashboard/${workspace}/flows${qs}`}
                                className="font-medium text-fg-secondary hover:underline"
                              >
                                {f}
                              </Link>
                            </span>
                          ))
                        )}
                      </span>
                    </span>
                  }
                />
              );
            })}
          </ul>
        </Card>
        </>
      )}
    </main>
  );
}
