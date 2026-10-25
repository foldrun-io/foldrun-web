// Checks: what `foldrun check` says about the deployed copy of this
// workspace — the deploy's own rules and the scanner (secrets written into a
// file, text a reviewer cannot see, an agent that could be talked into
// leaking, code fetched at whatever version was published last).
//
// The page frames it; the panel asks GET …/check, the same answer a CI job
// gets, so the dashboard and the API cannot disagree about a finding.

import fs from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { WorkspaceHeader } from "@/components/workspace-header";
import { PageHeader } from "@/components/ui";
import { ChecksPanel } from "./checks-panel";

export const dynamic = "force-dynamic";

export default async function ChecksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />
      <PageHeader
        title="Checks"
        subtitle={`What foldrun check says about ${workspace} as deployed: what a deploy refuses, what it warns about, and the security rules — secrets written into files, hidden text, agents that could leak, unpinned code. Offline; no model is called.`}
      >
        <Link href="https://docs.foldrun.io/checks" className="text-sm font-medium text-fg-muted hover:text-fg">
          Every rule →
        </Link>
      </PageHeader>
      <ChecksPanel workspace={workspace} tenantQuery={tenant !== "default" ? `&tenant=${tenant}` : ""} />
    </main>
  );
}
