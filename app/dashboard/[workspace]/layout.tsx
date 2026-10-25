// The gate on a workspace's pages: a member scoped to some workspaces is
// shown the others as not there. The API refuses the same way (server/api.ts);
// this is the page half. No session (dev mode) sees everything.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { verifySession, allowedWorkspaces, SESSION_COOKIE } from "@/server/users";
import { scopeAllows } from "@/platform/scope";

export default async function WorkspaceGate({ params, children }: { params: Promise<{ workspace: string }>; children: React.ReactNode }) {
  const { workspace } = await params;
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session && !scopeAllows(await allowedWorkspaces(session.tenant, session.id), workspace)) notFound();
  return children;
}
