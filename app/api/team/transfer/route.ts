// Hand the account to another member. Owner only, and the owner must be a
// signed-in person. The old owner becomes an admin: they keep running the
// account, they just stop being the one who pays for it.

import { NextRequest, NextResponse } from "next/server";
import { requirePerson, errorResponse, ApiError } from "@/server/api";
import { transferOwnership, listMembers } from "@/server/users";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePerson(req, "owner:transfer");
    const body = (await req.json().catch(() => ({}))) as { to?: unknown };
    if (typeof body.to !== "string" || !body.to) throw new ApiError("expected { to: <member id> }", 400);
    const target = (await listMembers(tenant)).find((m) => m.id === body.to);
    await transferOwnership(tenant, body.to, actor.id); // throws with a status
    await audit("owner.transferred", { actor: actor.name, tenant, subject: target?.email ?? body.to });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
