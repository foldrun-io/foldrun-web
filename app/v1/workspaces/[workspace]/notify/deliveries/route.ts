// The outbound webhook log: every notify: delivery from this workspace —
// a run failed, a gate is waiting, a test — with each attempt's status,
// time and answer. "Did Slack get it?" used to have no answer here.
//
//   GET ?status=pending|delivered|failed|skipped&event=failed&limit=50&offset=0
//   → { deliveries, total, limit, offset, endpoint }
//
// `endpoint` says whether this workspace's webhook is switched off after
// days of failures, and since when it has been failing.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { errorResponse, requireTenant, refuse } from "@/server/api";
import { intParam } from "@/server/query";
import { workspaceDir } from "@/lib/store";
import { endpointState, listDeliveries } from "@/platform/webhook-deliveries";
import { notifyConfig } from "@/lib/notify";

const STATUSES = new Set(["pending", "delivered", "failed", "skipped"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return refuse(`no workspace "${workspace}"`, 404);
    }
    const q = req.nextUrl.searchParams;
    const status = q.get("status") || undefined;
    if (status && !STATUSES.has(status)) {
      return refuse(`status is one of ${[...STATUSES].join(", ")}`, 400);
    }
    const limit = intParam(q.get("limit"), 50, 1, 200);
    const offset = intParam(q.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const { deliveries, total } = await listDeliveries(tenant, workspace, { status, event: q.get("event") || undefined, limit, offset });
    const endpoint = notifyConfig(tenant, workspace)?.url ? await endpointState(tenant, workspace) : null;
    return NextResponse.json({ deliveries, total, limit, offset, endpoint });
  } catch (err) {
    return errorResponse(err);
  }
}
