// The account's invites (29 Oct 2026): GET lists them — pending ones unless
// ?all=1 — so a person can see which links are still out and revoke one
// (DELETE /api/team/invites/<id>). Never the link itself: that exists only
// in the answer of the POST /api/team that made it.
//
// team:manage, a key included: seeing what is out and taking it back only
// narrows access. A caller scoped to some workspaces sees the invites
// inside its own scope only.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse } from "@/server/api";
import { listInvites } from "@/server/users";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "team:manage");
    const all = ["1", "true"].includes(req.nextUrl.searchParams.get("all") ?? "");
    return NextResponse.json({ invites: await listInvites(tenant, { all, scope: actor.workspaces }) });
  } catch (err) {
    return errorResponse(err);
  }
}
