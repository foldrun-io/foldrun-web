// GET /api/workspaces/<ws>/a2a — what this workspace serves over A2A: the
// flows whose frontmatter says `a2a:` (published or not), each one's card and
// endpoint URL, the live A2A keys for the workspace, and the newest A2A tasks
// with the key that asked (server/a2a-service.ts). A read: every role; the
// list of keys only for one who may manage keys (an admin), as GET /api/keys.
// Publishing is editing the flow's `a2a:` (PUT /source, PATCH /flows/<f>) —
// workspace:manage, server/workspace-policy.ts.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, refuse, requireCaller } from "@/server/api";
import { can } from "@/platform/permissions";
import { listWorkspaces } from "@/lib/store";
import { workspaceA2a } from "@/server/a2a-service";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    if (!listWorkspaces(tenant).some((w) => w.name === workspace)) return refuse(`no such workspace: ${workspace}`, 404);
    const view = await workspaceA2a(req, tenant, workspace);
    return NextResponse.json(can(actor.role, "keys:manage") ? view : { ...view, keys: null });
  } catch (err) {
    return errorResponse(err);
  }
}
