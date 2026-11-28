// The invites waiting on you (FOL-464): pending ones addressed to the
// address you hold, confirmed, for accounts you are not in yet. What the
// inbox and the account menu show; `path` is the invite's page, where Join
// and Decline are.
//
// A person: signed in to the dashboard, or their own `foldrun login` key.
// Any other key has no invites, because an invite is for a person; a
// support view and the operator console's sessions are refused.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/server/api";
import { requireSelf } from "@/server/invite-reach";
import { invitesFor } from "@/server/users";

export async function GET(req: NextRequest) {
  try {
    const { actor } = await requireSelf(req);
    return NextResponse.json({ invites: await invitesFor(actor.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
