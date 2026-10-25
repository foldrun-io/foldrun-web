// A workspace's kill switch.
//
//   GET                              { paused, account, workspace } — what holds runs here
//   POST { reason?, stop?: true }    pause: no new run starts here; stop also stops the live ones
//   DELETE                           resume
//
// A paused workspace refuses every start — schedule, webhook, a chained
// flow, a person's Run — with 423 and who paused it. The account's own pause
// holds here too, and only the account's resume lifts it.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { requireTenant, requirePermission, errorResponse, ApiError } from "@/server/api";
import { workspaceDir } from "@/lib/store";
import { pauseView, pause, resume } from "@/server/pause";

type Ctx = { params: Promise<{ workspace: string }> };

async function known(tenant: string, workspace: string) {
  if (!fs.existsSync(workspaceDir(tenant, workspace))) throw new ApiError("workspace not found", 404);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    await known(tenant, workspace);
    return NextResponse.json(await pauseView(tenant, workspace));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    await known(tenant, workspace);
    return await pause(tenant, actor, workspace, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    await known(tenant, workspace);
    return await resume(tenant, actor, workspace);
  } catch (err) {
    return errorResponse(err);
  }
}
