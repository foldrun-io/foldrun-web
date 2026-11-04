// Evals by change — the workspace Observe page's table (`foldrun eval
// trends`): per eval, its latest run, the most recent run on a DIFFERENT
// commit, and the pass count between them. Core evals.ts evalTrends, the
// function the page renders from. Independent of any window: a regression is
// a comparison between two commits, whenever they ran.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { errorResponse, refuse, requireTenant } from "@/server/api";
import { workspaceDir } from "@/lib/store";
import { evalTrends } from "@/lib/evals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) return refuse(`no workspace "${workspace}"`, 404);
    return NextResponse.json({ workspace, trends: evalTrends(tenant, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}
