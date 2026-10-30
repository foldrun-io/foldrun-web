// Hand the account to another member. Owner only, and the owner must be a
// signed-in person. The old owner becomes an admin: they keep running the
// account, they just stop being the one who pays for it.
//
//   POST { to: <member id>, password, code? }
//
// The owner proves it is them again (30 Oct 2026), as changing their own
// password or email does: the current password, and a code from the app (or
// a backup code) when two-step sign-in is on. Without it a borrowed or
// stolen owner session handed the whole account to a member of the
// attacker's choosing. Six tries in fifteen minutes, like the password.

import { NextRequest, NextResponse } from "next/server";
import { requirePerson, errorResponse, ApiError } from "@/server/api";
import { transferOwnership, listMembers, findUserById, passwordMatches, openString, mfaBinding, consumeBackupCode } from "@/server/users";
import { verifyTotp, hashBackup } from "@/server/totp";
import { refuseWhenLimited, clearLimit } from "@/server/limits";
import { audit } from "@/server/audit";

const LIMIT = { limit: 6, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePerson(req, "owner:transfer");
    const limited = await refuseWhenLimited(`transfer:${actor.id}`, LIMIT.limit, LIMIT.windowSec);
    if (limited) return limited;
    const body = (await req.json().catch(() => ({}))) as { to?: unknown; password?: unknown; code?: unknown };
    if (typeof body.to !== "string" || !body.to) throw new ApiError("expected { to: <member id>, password, code? }", 400);
    if (typeof body.password !== "string" || !body.password) {
      throw new ApiError("handing over the account needs your current password (and a code from your app when two-step sign-in is on): { to, password, code? }", 400);
    }
    if (!(await passwordMatches(actor.id, body.password))) throw new ApiError("that is not your password", 401);
    const me = await findUserById(actor.id);
    if (!me) throw new ApiError("sign in first", 401);
    if (me.mfaSecret) {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!code) throw new ApiError("two-step sign-in is on — add a code from your app, or a backup code", 400);
      const ok = verifyTotp(openString(me.mfaSecret, mfaBinding(me.id)), code) || (await consumeBackupCode(me.id, hashBackup(code)));
      if (!ok) throw new ApiError("that code is not right", 401);
    }
    const target = (await listMembers(tenant)).find((m) => m.id === body.to);
    await transferOwnership(tenant, body.to, actor.id); // throws with a status
    await clearLimit(`transfer:${actor.id}`);
    await audit("owner.transferred", { actor: actor.name, tenant, subject: target?.email ?? body.to });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
