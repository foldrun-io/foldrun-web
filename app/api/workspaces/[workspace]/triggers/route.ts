// Why nothing happened.
//
// One row per flow: how often its trigger fired, how often that became a
// run, and what happened to the difference. Plus the raw decisions, newest
// first, for the case where the summary is not enough.
//
// ?days=7 narrows the window in days (?since=7, the older spelling, still
// works). The log is bounded, so a long window simply reaches the end of it
// rather than costing anything.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { requireTenant, errorResponse } from "@/server/api";
import { intParam } from "@/server/query";
import { summariseTriggers, readTriggerEvents } from "@/lib/trigger-log";
import { readDeliveries } from "@/lib/webhook";
import { workspaceDir } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return NextResponse.json({ error: `no workspace "${workspace}"` }, { status: 404 });
    }
    const q = req.nextUrl.searchParams;
    const days = intParam(q.get("days") ?? q.get("since"), 7, 1, 365);
    const sinceMs = Date.now() - days * 86400_000;
    return NextResponse.json({
      days,
      flows: summariseTriggers(tenant, workspace, sinceMs),
      events: readTriggerEvents(tenant, workspace, 200).filter((e) => new Date(e.t).getTime() >= sinceMs),
      // The other half of the question, and a genuinely different one: this
      // is whether a request reached us and was authentic, before any flow
      // rule got a say. A bad token never becomes a trigger event at all.
      deliveries: readDeliveries(tenant, workspace, 50),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
