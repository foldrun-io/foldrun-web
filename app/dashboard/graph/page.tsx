import { buildAccountGraph } from "@/server/graph";
import { viewerScope } from "@/server/users";
import { GraphClient } from "@/app/dashboard/[workspace]/graph/graph-client";

export const dynamic = "force-dynamic";

/**
 * The whole account, in one picture.
 *
 * The workspace graph answers "how does work flow here". This one answers
 * "what is there, and what is shared" — every workspace, every agent, flow and
 * file, plus the library-tool grants that cross a workspace boundary.
 *
 * The model is built here rather than in the client component because it reads
 * many workspaces off disk. The client gets plain serialisable data and draws
 * it with the same renderer the workspace view uses.
 */
export default async function AccountGraphPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant = "default" } = await searchParams;
  // A member scoped to some workspaces sees only those, here as everywhere.
  const graph = buildAccountGraph(tenant, await viewerScope());

  return (
    <main className="h-[calc(100vh-4rem)]">
      <GraphClient
        tenant={tenant}
        graph={graph}
        title="account"
        emptyMessage="Nothing to graph yet — create a workspace and add an agent."
      />
    </main>
  );
}
