// How you want to be addressed. Two optional halves; null clears one.
// No password needed — a name is not a credential, and asking for one here
// would teach people that the password prompt is furniture.

import { errorResponse, sessionUser } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { setName } from "@/server/users";

export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { firstName?: string | null; lastName?: string | null };
  try {
    await setName(user.id, body.firstName ?? null, body.lastName ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
