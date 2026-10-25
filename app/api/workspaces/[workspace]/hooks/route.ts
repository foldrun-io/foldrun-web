// The hooks a workspace's agents can turn on, and what they did lately.
//
// Static beside hooks/[flow]/ (a flow's webhook URL, and a hook's Test):
// the list is hooks/ in the workspace and in the account library, the
// workspace's shadowing the library's by name; `recent` is every deny,
// rewrite and failure a hook wrote into this workspace's runs, newest first.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import fs from "node:fs";
import { listRuns, workspaceDir } from "@/lib/store";
import { listWorkspaceHooks } from "@/server/hooks";
import { hookActivity } from "@/components/hooks-model";
import { intParam } from "@/server/query";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) throw new ApiError(`no workspace "${workspace}"`, 404);
    // How many runs to read back through, newest first: 1..500, 50 unasked.
    const runs = intParam(req.nextUrl.searchParams.get("runs"), 50, 1, 500);
    const all = req.nextUrl.searchParams.get("all") === "1";
    return NextResponse.json({
      hooks: listWorkspaceHooks(tenant, workspace),
      recent: hookActivity(listRuns(tenant, workspace).slice(0, runs), { limit: 200, loud: !all }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
