// The observability report as one JSON document — the same aggregation the
// Observe page renders, for anyone pointing a script or a spreadsheet at it.
// ?days=7 widens or narrows the window in days (?since=7, the older
// spelling, still works).

import { runCharges } from "@/server/run-charges";
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { requireTenant, errorResponse, refuse } from "@/server/api";
import { intParam } from "@/server/query";
import { observeWorkspace } from "@/platform/observe";
import { workspaceDir } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return refuse(`no workspace "${workspace}"`, 404);
    }
    const q = req.nextUrl.searchParams;
    // Clamped: a window of 0 is a report about nothing, and five years of
    // journals is a filesystem walk nobody priced.
    const days = intParam(q.get("days") ?? q.get("since"), 30, 1, 365);
    return NextResponse.json(observeWorkspace(tenant, workspace, days, undefined, await runCharges(tenant)));
  } catch (err) {
    return errorResponse(err);
  }
}
