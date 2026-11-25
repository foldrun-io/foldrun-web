// The trial lands on a VERIFIED owner, once per account, and not a moment
// before: credits handed out at signup are credits a script can farm with
// throwaway addresses; a working inbox is the cheapest proof of a person we
// have. Joiners bring nothing — their team has a wallet. And only an account
// that came in by a door that earns it (7 Nov 2026, core signup.ts
// trialEligible): a paid sign-up bought a plan, and one still waiting to pay
// must never run on free credit. On top of hosted and owner, never instead
// of them.
//
// Every way an address becomes confirmed calls this: the Confirm button
// (app/v1/auth/verify) and a password reset of an unconfirmed address
// (app/v1/auth/reset, FOL-315: that reset is now the way in for a person who
// never used the confirmation link). grantTrial is once per account, so two
// doors or two calls give one grant.

import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { trialEligible } from "@/platform/signup";
import { isOwner, accountAdmission } from "@/server/users";

export async function grantTrialIfEarned(user: { id: string; tenant: string }): Promise<void> {
  if (platform.edition() === "hosted" && (await isOwner(user.tenant, user.id)) && trialEligible(await accountAdmission(user.tenant))) {
    await billing().grantTrial(user.tenant);
  }
}
