// The four jobs — governance, guardrail, observability, evaluation — as this
// account (and, with ?workspace=, one workspace) has them set in AGENTS.md.
//
//   GET [?workspace=<ws>]   { jobs: [{ name, title, what, fields: [{ key, account, workspace?, effective }] }] }

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { requireCaller, assertWorkspaceScope, errorResponse, ApiError } from "@/server/api";
import { workspaceDir } from "@/lib/store";
import { jobsView } from "@/server/jobs";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const workspace = req.nextUrl.searchParams.get("workspace") || null;
    if (workspace) {
      assertWorkspaceScope(actor, workspace);
      if (!fs.existsSync(workspaceDir(tenant, workspace))) throw new ApiError("workspace not found", 404);
    }
    return NextResponse.json({ ...(workspace ? { workspace } : {}), jobs: jobsView(tenant, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}
