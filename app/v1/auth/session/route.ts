// Who am I, and can anyone else join? The login and signup pages render off
// this instead of guessing.

//
//   POST { account }   the session moves to another account the person is in
//   POST { invite }    the signed-in person joins the invite's account, and
//                      the session moves there
//
// One login may be in several accounts (FOL-464), and a session is for one
// of them. Moving is a new session for the other account and the end of this
// one: nothing a request carries names an account, so no request can act in
// one account on a session made for another. The new session continues the
// old: it ends when that one would have, with the second factor as old as it
// was, so moving back and forth never renews a sign-in.

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE, signupOpen, hasUsers, roleOfUser, accountsOf, moveSession, sessionCookieOptions } from "@/server/users";
import { avatarUrl } from "@/platform/avatars";
import { errorResponse, refuse, refuseWith, sessionUser } from "@/server/api";
import { ACCOUNT_MOVED } from "@/server/auth";
import { refuseNonText } from "@/server/auth-input";
import { jsonObject } from "@/server/body";
import { audit } from "@/server/audit";
import { rateLimit } from "@/platform/cache";
import { clientIp, tooManyAttempts } from "@/server/limits";

export async function GET(req: NextRequest) {
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({
    // The role rides along so the dashboard can draw only the controls this
    // person may use — the same table the API refuses with.
    user: user
      ? {
          id: user.id,
          email: user.email,
          tenant: user.tenant,
          role: (await roleOfUser(user.tenant, user.id)) ?? "viewer",
          avatar: avatarUrl(user.tenant, "user", user.id),
          accountAvatar: avatarUrl(user.tenant, "account", user.tenant),
          // What the profile page draws its two security sections from.
          emailVerifiedAt: user.emailVerifiedAt ?? null,
          mfaEnabled: !!user.mfaEnabledAt,
          // Every account this login is in, this session's first among
          // equals: what the account menu lists when there is more than one.
          // A support view is of one account, and the operator console's
          // sessions are not the dashboard's: neither is shown the others.
          accounts: (user.viewAs || user.session?.audience ? [] : await accountsOf(user.id)).map((a) => ({ tenant: a.tenant, role: a.role, current: a.tenant === user.tenant })),
          // No way into the operator console is drawn here (30 Oct 2026):
          // its operators are people Cloudflare Access and their own second
          // factor vouch for at its own address, not an account in this app.
        }
      : null,
    signupOpen: await signupOpen(),
    hasUsers: await hasUsers(),
  });
}

const JOIN_TRIES = { limit: 20, windowSec: 15 * 60 };

export async function POST(req: NextRequest) {
  try {
    // A browser session's own request. A key beside the cookie would be what
    // the proxy checked and metered, and the cookie what moved: refused.
    if (req.headers.get("authorization") || req.headers.get("x-api-key")) return refuse("a session moves by its own cookie alone: send no key with this request", 400);
    // A person's own session; a support view moves nowhere (sessionUser refuses its writes).
    const me = await sessionUser(req);
    if (me instanceof Response) return me;
    if (!me?.session || me.viewAs) return refuse("sign in first", 401);
    // The operator console's sessions are for the console alone.
    if (me.session.audience) return refuse("this session is not one for the dashboard", 403);
    const body = (await jsonObject(req)) as { account?: unknown; invite?: unknown; as?: unknown };
    const notText = refuseNonText(body, "account", "invite", "as");
    if (notText) return notText;
    // The person the page showed as signed in (`as`, a user id): another tab
    // may have signed in as someone else since, and that person did not press
    // this button. The account it showed is `x-foldrun-account` (sessionUser).
    if (typeof body.as === "string" && body.as && body.as !== me.id) return refuseWith("this page is showing another person than the one this browser is signed in as now — reload the page", ACCOUNT_MOVED, { code: "account_moved" });
    const account = typeof body.account === "string" ? body.account : "";
    const invite = typeof body.invite === "string" ? body.invite : "";
    if (Boolean(account) === Boolean(invite)) return refuse("expected { account } to move to an account you are in, or { invite } to join one", 400);

    if (invite) {
      // As the sign-up form's tries are counted: by who asks and from where.
      const ip = clientIp(req);
      for (const key of [`join:user:${me.id}`, ...(ip ? [`join:ip:${ip}`] : [])]) {
        const tries = await rateLimit(key, JOIN_TRIES.limit, JOIN_TRIES.windowSec);
        if (!tries.allowed) return tooManyAttempts(tries.retryAfter);
      }
    }
    // One write under the people lock (users.ts moveSession): the old session
    // spent, the membership made when it is a join, the new session written.
    // Refused anywhere, nothing happened and the session is where it was.
    const moved = await moveSession(me, invite ? { invite } : { account }, req.headers.get("user-agent"));
    const { user: to, session } = moved;
    if (moved.invite) {
      await audit("member.joined", {
        actor: me.email,
        tenant: to.tenant,
        subject: me.id,
        detail: { role: moved.invite.role, workspaces: moved.invite.workspaces, inviteId: moved.invite.id, invitedBy: moved.invite.createdByEmail, existingLogin: true },
      });
    }
    // The account it came from is not this account's to know.
    await audit("login", { actor: me.email, tenant: to.tenant, subject: session.sessionId, detail: { method: "account-switch" } });
    const res = NextResponse.json({ ok: true, tenant: to.tenant });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
