// Sign out = forget the cookie AND end the session's row, so a copy of the
// cookie (another tab's, a stolen one) stops working too.
//
// A support view signing out ends the view too, and takes the parked
// session with it: "sign out" in a borrowed view means out, not home.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, sessionIdOf } from "@/server/users";
import { revokeSession } from "@/server/sessions";
import { SUPPORT_HOME_COOKIE } from "@/server/view-as";
import { billing } from "@/platform/billing";
import { appendAudit } from "@/platform/admin";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token).catch(() => null);
  if (session?.viewAs) {
    if (await billing().endSupportView(session.tenant, session.viewAs.id, session.viewAs.by).catch(() => false)) {
      await appendAudit({ t: new Date().toISOString(), by: session.viewAs.by, tenant: session.tenant, action: "view_as_ended", detail: { view: session.viewAs.id, via: "sign-out" } });
      await audit("support.ended", { actor: `support:${session.viewAs.by}`, tenant: session.tenant, subject: session.viewAs.id, detail: { reason: session.viewAs.reason, endedBy: "sign-out" } });
    }
  } else if (session) {
    const id = sessionIdOf(token);
    if (id) await revokeSession(session.id, id).catch(() => false);
    await audit("logout", { actor: session.email, tenant: session.tenant });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(SUPPORT_HOME_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
