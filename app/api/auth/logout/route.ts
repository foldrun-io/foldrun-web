// Sign out = forget the cookie. A revocable session's row is left to expire;
// Settings → Sessions ends one for good.
//
// A support view signing out ends the view too, and takes the parked
// session with it: "sign out" in a borrowed view means out, not home.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/users";
import { SUPPORT_HOME_COOKIE } from "@/server/view-as";
import { billing } from "@/platform/billing";
import { appendAudit } from "@/platform/admin";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (session?.viewAs) {
    if (await billing().endSupportView(session.tenant, session.viewAs.id, session.viewAs.by).catch(() => false)) {
      await appendAudit({ t: new Date().toISOString(), by: session.viewAs.by, tenant: session.tenant, action: "view_as_ended", detail: { view: session.viewAs.id, via: "sign-out" } });
      await audit("support.ended", { actor: `support:${session.viewAs.by}`, tenant: session.tenant, subject: session.viewAs.id, detail: { reason: session.viewAs.reason, endedBy: "sign-out" } });
    }
  } else if (session) {
    await audit("logout", { actor: session.email, tenant: session.tenant });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(SUPPORT_HOME_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
