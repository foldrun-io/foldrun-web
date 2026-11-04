// The zone this person reads timestamps in.
//
// Stored only when it differs from what their browser would say: absent means
// automatic, which is the default and covers almost everyone. Sending null
// clears the override and goes back to automatic.

import { errorResponse, personOf, refuse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { setUserTimezone } from "@/server/users";

export async function POST(req: NextRequest) {
  // The signed-in person, or the one behind this machine's `foldrun login`.
  const user = await personOf(req);
  if (user instanceof Response) return user;
  if (!user) return refuse("sign in first", 401);

  const body = (await req.json().catch(() => ({}))) as { timezone?: string | null };
  try {
    // The zone is validated in setUserTimezone against Intl itself, so an
    // unknown one is refused here rather than stored and thrown on later at
    // every timestamp the person looks at.
    await setUserTimezone(user.id, body.timezone ?? null);
    return NextResponse.json({ ok: true, timezone: body.timezone ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
