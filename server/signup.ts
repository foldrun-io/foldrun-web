// The sign-up switches as this server runs them (7 Nov 2026): one resolver
// for the sign-up page, POST /api/auth/signup, /api/auth/session and the
// open GET /api/signup, so none of them works the doors out differently.
//
// The rules are core's (platform signup.ts): free is signup.open, paid is
// hosted-only and effective only when billing's signupOffer() finds nothing
// in its way, and the first account is its own door (bootstrap), never
// advertised as free sign-up. What this file adds is where the inputs come
// from: the edition, the settings snapshot, and billing() — the only way
// open code reaches the hosted business.

import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { settingText } from "@/platform/settings";
import { signupModes, type PublicPlan, type SignupModes, type SignupOffer } from "@/platform/signup";

/** The origins that may read GET /api/signup from a browser: foldrun.io's
 *  sign-up buttons and plan cards, and the docs site's. Exact matches,
 *  comma-separated in FOLDRUN_SIGNUP_ORIGINS to replace the list. */
export function signupOrigins(): string[] {
  const env = process.env.FOLDRUN_SIGNUP_ORIGINS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://foldrun.io", "https://www.foldrun.io", "https://docs.foldrun.io"];
}

function inputs(): { hosted: boolean; freeSetting: boolean; offer: SignupOffer | null } {
  const hosted = platform.edition() === "hosted";
  return {
    hosted,
    freeSetting: settingText("FOLDRUN_OPEN_SIGNUP") === "1",
    offer: hosted ? (billing().signupOffer?.() ?? null) : null,
  };
}

/** Every door, effectively, on this pod now. `usersExist` decides the
 *  bootstrap door: pass what the caller read (inside the users lock when it
 *  admits; a plain read when it only decides what to show). */
export function signupModesNow(usersExist: boolean): SignupModes {
  return signupModes({ ...inputs(), usersExist });
}

/** GET /api/signup's answer — exactly these three keys. */
export interface PublicSignup {
  free: boolean;
  paid: boolean;
  plans: PublicPlan[];
}

/**
 * What the public may know: is the free door open, is the paid one, and —
 * only when paid sign-up is in effect — the plans it sells. Advisory: the
 * sign-up POST asks again. The bootstrap door is never reported (it is the
 * install's, not the public's), so this reads no user rows at all.
 */
export function publicSignup(): PublicSignup {
  const i = inputs();
  const m = signupModes({ ...i, usersExist: true });
  const plans = m.paid && i.offer ? i.offer.plans : [];
  return {
    free: m.free,
    paid: m.paid,
    // Field by field: nothing billing adds to a plan later reaches the
    // public by accident.
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      price: { amount: p.price.amount, currency: p.price.currency, interval: p.price.interval },
      credits: p.credits,
      storageGb: p.storageGb,
      vcpu: p.vcpu,
      memoryGiB: p.memoryGiB,
      priority: p.priority,
    })),
  };
}

/** The hosted platform's address for a person who wants an account while
 *  registration is closed. A constant, like the suspended banner's. */
export const SIGNUP_CONTACT = "hello@foldrun.io";

/** What the sign-up page draws. */
export type SignupPageState = "invite" | "invite-invalid" | "setup" | "form" | "closed";

/**
 * The sign-up page's decision, kept apart from the page so it can be tested:
 * a valid invite is its own permission; a dead one says so; the first
 * account of an install with a setup token needs its link; the form shows
 * for the first account or while free sign-up is open; otherwise
 * registration is closed. Paid sign-up draws nothing here yet — its plan
 * choice is Part B (FOL-125) — so with only the paid door open the page is
 * closed, which is the safe way round until that form exists.
 */
export function signupPageState(i: {
  inviteGiven: boolean;
  inviteValid: boolean;
  setupRequired: boolean;
  setupGiven: boolean;
  modes: Pick<SignupModes, "bootstrap" | "free" | "paid">;
}): SignupPageState {
  if (i.inviteValid) return "invite";
  if (i.inviteGiven) return "invite-invalid";
  if (i.setupRequired && !i.setupGiven) return "setup";
  if (i.modes.bootstrap || i.modes.free) return "form";
  return "closed";
}
