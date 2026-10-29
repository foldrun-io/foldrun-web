// Sign out = forget the cookie AND end the session's row, so a copy of the
// cookie (another tab's, a stolen one) stops working too.
//
// A support view (hosted only) signing out ends the view too, and takes the
// parked session with it: server/view-as.ts supportSignOut.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, sessionIdOf } from "@/server/users";
import { revokeSession } from "@/server/sessions";
import { supportSignOut } from "@/server/view-as";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  const res = NextResponse.json({ ok: true });
  // A support view's sign-out (hosted only: server/view-as.ts) is the view's
  // to end; it is never the owner's.
  if (!(await supportSignOut(session, res)) && session) {
    const id = sessionIdOf(token);
    if (id) await revokeSession(session.id, id).catch(() => false);
    await audit("logout", { actor: session.email, tenant: session.tenant });
  }
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
