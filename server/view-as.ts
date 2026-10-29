// Support's read-only view of a customer account — the hosted operator
// console's (foldrun-admin), and not part of this repository.
//
// As this repository has it there are no support views: no token resolves
// to one, nothing needs ending at sign-out, and were a session ever marked
// as one, every request would be refused. The hosted build replaces this
// file with the real rules (foldrun-admin overlay.sh); server/users.ts,
// server/auth.ts, server/api.ts, server/api-limits.ts and the sign-out
// route ask it, and nothing else decides.

import type { NextResponse } from "next/server";
import type { UserRecord } from "./users.ts";

/** The live grant a support token names: there are none. */
export async function liveSupportView(_tenant: string, _id: string): Promise<{ id: string; by: string; reason: string; expiresAt: string } | null> {
  return null;
}

/** Why this request is refused under a support view: every one is. */
export function supportViewRefusal(_method: string, _pathname: string): string | null {
  return "support views are not part of this install";
}

/** Sign-out's part for a support view: true when it handled the sign-out
 *  of one (the caller then does nothing else for it). There are none. */
export async function supportSignOut(_session: UserRecord | null, _res: NextResponse): Promise<boolean> {
  return false;
}

/** A write the API's rate limits never refuse, besides signing out: none. */
export function supportExempt(_method: string, _pathname: string): boolean {
  return false;
}
