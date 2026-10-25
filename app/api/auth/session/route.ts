// Who am I, and can anyone else join? The login and signup pages render off
// this instead of guessing.

import { isSuperAdmin } from "@/platform/admin";
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
          // Whether the super admin console exists for them: the owner of
          // the platform's own account, nobody else. The client must not
          // guess this; false for everyone else, including on the community
          // image where there is no console.
          superAdmin: isSuperAdmin({ tenant: user.tenant, owner: user.owner }),
        }
      : null,
    signupOpen: await signupOpen(),
    hasUsers: await hasUsers(),
  });
}
