// How you want to be addressed. Two optional halves; null clears one.
// No password needed — a name is not a credential, and asking for one here
// would teach people that the password prompt is furniture.

import { errorResponse, personOf, refuse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { setName } from "@/server/users";
import { refuseNonText } from "@/server/auth-input";
import { jsonObject } from "@/server/body";

export async function POST(req: NextRequest) {
  // The signed-in person, or the one behind this machine's `foldrun login`.
  const user = await personOf(req);
  if (user instanceof Response) return user;
  if (!user) return refuse("sign in first", 401);
  // A body that is not a JSON object is refused here, outside any try.
  const read = await jsonObject(req, { optional: true }).catch((err: unknown) => errorResponse(err));
  if (read instanceof Response) return read;
  const body = read as { firstName?: string | null; lastName?: string | null };
  const notText = refuseNonText(body, "firstName", "lastName");
  if (notText) return notText;
  try {
    await setName(user.id, body.firstName ?? null, body.lastName ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
