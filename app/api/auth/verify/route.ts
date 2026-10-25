// The verification link lands here. The token names the user and the
// address it was sent to; if they still match, the address is verified and
// the person is sent to the dashboard. No session is minted — verifying an
// address is not signing in.

import { NextRequest, NextResponse } from "next/server";
import { readToken } from "@/server/auth-tokens";
import { findUserById, setEmailVerified } from "@/server/users";
import { audit } from "@/server/audit";
import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { isOwner } from "@/server/users";
import { publicOrigin } from "@/server/auth-flows";

export async function GET(req: NextRequest) {
  const claims = readToken("verify", req.nextUrl.searchParams.get("token") ?? "");
  const user = claims ? await findUserById(claims.u) : null;
  if (!user || user.email !== claims!.e) {
    return NextResponse.redirect(new URL("/login?verify=invalid", publicOrigin(req)));
  }
  await setEmailVerified(user.id);
  await audit("email.verified", { actor: user.email, tenant: user.tenant });
  // The trial lands on a VERIFIED owner, once per account, and not a
  // moment before: credits handed out at signup are credits a script can
  // farm with throwaway addresses; a working inbox is the cheapest proof
  // of a person we have. Joiners bring nothing — their team has a wallet.
  if (platform.edition() === "hosted" && (await isOwner(user.tenant, user.id))) await billing().grantTrial(user.tenant);
  return NextResponse.redirect(new URL("/dashboard?verified=1", publicOrigin(req)));
}
