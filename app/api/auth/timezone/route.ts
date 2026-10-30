// The zone this person reads timestamps in.
//
// Stored only when it differs from what their browser would say: absent means
// automatic, which is the default and covers almost everyone. Sending null
// clears the override and goes back to automatic.

import { errorResponse, sessionUser } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { setUserTimezone } from "@/server/users";

export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

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
