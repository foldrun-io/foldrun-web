// "Move to shared": a workspace's skill, tool, script, knowledge or memory
// file into the account library, and out of the workspace — in one call.
//
//   POST /api/workspaces/<ws>/source/share  { path, overwrite?, dryRun? }
//
// The move is core's (moveToLibrary): a skill or folder tool goes as its
// whole folder, everything is checked before anything is written, and the
// copy and the delete happen together. Done by the client (dashboard, CLI)
// it copied one file and deleted the folder, losing a skill's other files.
//
// The library is every workspace's, so the caller must be account-wide —
// the same rule as writing the library directly (PUT /api/library/<kind>).

import { NextRequest, NextResponse } from "next/server";
import { requireAccountWide, errorResponse, actorOf, refuse } from "@/server/api";
import { moveToLibrary } from "@/lib/library";
import { jsonObject } from "@/server/body";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { tenant } = await requireAccountWide(req, "workspace:write");
    const { workspace } = await ctx.params;
    const body = await jsonObject(req);
    if (typeof body.path !== "string" || !body.path) return refuse("expected { path } — a skill, tool, script, knowledge or memory file", 400);
    if (body.overwrite !== undefined && typeof body.overwrite !== "boolean") return refuse("overwrite is true or false", 400);
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") return refuse("dryRun is true or false", 400);
    const moved = moveToLibrary(tenant, workspace, body.path, {
      overwrite: body.overwrite === true,
      dryRun: body.dryRun === true,
      by: await actorOf(req),
    });
    return NextResponse.json({ ok: true, ...moved });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
