// GET /api/mcp/connections — the AI apps connected to this account over OAuth
// (server/mcp-oauth.ts): which app, whose approval, what access, when it was
// last used. An admin (keys:manage) sees every one; anyone else, their own.
// ?all=1 adds the revoked ones.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { connectionView, listGrants, type GrantRecord } from "@/server/mcp-oauth";
import { can } from "@/platform/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const mine = (g: GrantRecord) => g.email.toLowerCase() === actor.name.toLowerCase();
    const every = can(actor.role, "keys:manage");
    const all = await listGrants(tenant, { all: req.nextUrl.searchParams.get("all") === "1" });
    return NextResponse.json({ connections: all.filter((g) => every || mine(g)).map(connectionView), everyone: every });
  } catch (err) {
    return errorResponse(err);
  }
}
