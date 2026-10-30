// The app's front door: one hop to wherever this person actually belongs.
//
// The landing page used to live here, which meant foldrun.io and the dashboard
// were one Next server — the site went down when the box did, and shipped on
// the app's deploy cadence. It moved to site/.
//
// What replaces it is not the login page itself. Rendering login at `/` would
// serve a form to the people who least need one: app.foldrun.io is a bookmark,
// and a bookmark belongs to somebody who is already signed in. So the session
// decides, the same way proxy.ts decides it — including the empty-install case,
// where sending the install's first person to a login they cannot pass is a dead end
// and signup is the only door that opens.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE, hasUsers } from "@/server/users";

export default async function Root() {
  // Local development trusts the URL, exactly as proxy.ts does — `next dev`
  // sets this and nothing else does.
  if (process.env.FOLDRUN_DEV_NO_AUTH === "1") redirect("/dashboard");

  const user = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  redirect(user ? "/dashboard" : (await hasUsers()) ? "/login" : "/signup");
}
