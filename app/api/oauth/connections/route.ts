// OAuth connection health: one row per oauth2 secret, with the saved client
// a reconnect would run and whether the grant still works. Read by the
// dashboard's Connections list and `foldrun secrets status`.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import { connectionStatus } from "@/platform/oauth-connections";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // A scoped caller sees its own workspaces' connections, never the account's.
    const rows = (await connectionStatus(tenant)).filter((c) => actor.workspaces === null || (c.workspace !== undefined && scopeAllows(actor.workspaces, c.workspace)));
    return NextResponse.json({ connections: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
