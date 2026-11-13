// Read-your-writes across pods (14 Nov 2026).
//
// With revisions.mirror on, each web and worker pod keeps its own copy of the
// workspace folders, brought level with the heads every few seconds
// (FOLDRUN_MIRROR_POLL_MS). A workspace made through one web pod answered 404
// on the other until that poll came round, and a deleted one stayed listed
// for ~10 s (cloudhost's lab Agent: create, then PUT a secret at once). So a
// request first brings what it names level with the heads:
//
//   /api/workspaces/<ws>/…, or ?workspace=<ws>    that workspace
//   /api/workspaces (list, create)                 the account's workspaces
//   /api/library…, /api/account/agents-md          the account shelf (@library)
//
// One indexed read of the heads when nothing moved; a sync only when it did.
// Bounded: past FRESH_MS the request is answered from the copy it has, and a
// failure is logged by the sync, never thrown — freshness must not become an
// outage. Off (mirror off, a laptop, self-host on one disk): nothing happens.

import type { NextRequest } from "next/server";
import { mirrorOn } from "@/lib/mirror-base";
import { syncFromHeads, syncTenantFromHeads } from "@/lib/workspace-revisions";

const FRESH_MS = 2_000;
const WS = /^\/api\/workspaces\/([^/]+)/;

/** What a request names, for the sync: a workspace, the account, the shelf, or nothing. */
export function freshTarget(pathname: string, workspaceParam: string | null): { workspace: string } | { account: true } | null {
  const m = pathname.match(WS);
  if (m) return { workspace: decodeURIComponent(m[1]) };
  if (workspaceParam) return { workspace: workspaceParam };
  if (pathname === "/api/workspaces") return { account: true };
  if (pathname === "/api/library" || pathname.startsWith("/api/library/") || pathname === "/api/account/agents-md") return { workspace: "@library" };
  return null;
}

export async function freshen(req: NextRequest, tenant: string): Promise<void> {
  if (!mirrorOn()) return;
  const t = freshTarget(req.nextUrl.pathname, req.nextUrl.searchParams.get("workspace"));
  if (!t) return;
  const work = "account" in t ? syncTenantFromHeads(tenant) : syncFromHeads(tenant, t.workspace);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work.catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FRESH_MS);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
