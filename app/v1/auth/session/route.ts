// Who am I, and can anyone else join? The login and signup pages render off
// this instead of guessing.

import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE, signupOpen, hasUsers, roleOfUser } from "@/server/users";
import { avatarUrl } from "@/platform/avatars";

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
          // No way into the operator console is drawn here (30 Oct 2026):
          // its operators are people Cloudflare Access and their own second
          // factor vouch for at its own address, not an account in this app.
        }
      : null,
    signupOpen: await signupOpen(),
    hasUsers: await hasUsers(),
  });
}
