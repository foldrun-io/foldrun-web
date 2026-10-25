import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, listFlows, agentAssets } from "@/lib/store";
import { GraphClient } from "./graph-client";
import { buildWorkspaceGraph } from "@/server/graph";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  // Built here, like the account view: reading a workspace off disk is the
  // server's job, and the client gets plain serialisable data either way.
  // FlowPanel still needs the flows themselves, so those are passed too.
  const flows = listFlows(tenant, workspace);
  const agents = listAgents(tenant, workspace).map((a) => ({
    ...a,
    assets: agentAssets(tenant, workspace, a.name),
  }));
  const graph = buildWorkspaceGraph(tenant, workspace);

  return (
    <GraphClient
      workspace={workspace}
      tenant={tenant}
      agents={agents}
      flows={flows}
      graph={graph}
    />
  );
}
