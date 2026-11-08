// Checks: what `foldrun check` says about the deployed copy of this
// workspace — the deploy's own rules and the scanner (secrets written into a
// file, text a reviewer cannot see, an agent that could be talked into
// leaking, code fetched at whatever version was published last).
//
// The page frames it; the panel asks GET …/check, the same answer a CI job
// gets, so the dashboard and the API cannot disagree about a finding.

import fs from "node:fs";
import Link from "@foldrun/ui/react/link";
import { notFound } from "next/navigation";
import { workspaceDir } from "@/lib/store";
import { BookOpen } from "lucide-react";
import { Page, PageHeader } from "@foldrun/ui/react/page";
import { buttonVariants } from "@foldrun/ui/react/button";
import { ChecksPanel } from "./checks-panel";
import { can } from "@/platform/permissions";
import { viewerRole } from "@/server/users";

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
  // The online checks fetch OSV and remote MCP servers, an editor's ask
  // since 30 Oct 2026; a viewer is not offered a button the API refuses.
  const role = await viewerRole();
  const canOnline = role === null || can(role, "workspace:write");

  return (
    <Page>
      <PageHeader
        title="Checks"
        description="What foldrun check says about this workspace as deployed: what a deploy refuses, what it warns about, and the security rules. Offline; no model is called."
        actions={
          <Link href="https://docs.foldrun.io/checks" className={buttonVariants({ variant: "secondary", size: "md" })}>
            <BookOpen aria-hidden />
            Every rule
          </Link>
        }
      />
      <ChecksPanel workspace={workspace} tenantQuery={tenant !== "default" ? `&tenant=${tenant}` : ""} canOnline={canOnline} />
    </Page>
  );
}
