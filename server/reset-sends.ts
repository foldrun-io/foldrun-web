// How many reset links may be mailed, whichever door asked for one (FOL-315).
//
// Two public routes mail the reset link: /v1/auth/forgot, and the emailed-code
// request for an account whose address is not verified yet. Each has its own
// request limits, which a caller can see; the MAIL that goes is counted here,
// once, for both, so the two doors together never send more than one would:
//
//   - per address: 3 an hour, both doors together (what /forgot always
//     promised one address)
//   - the install: 300 an hour, both doors together
//   - per caller, when a trusted proxy names it: 10 an hour on EACH door, so
//     up to 20 across both. /forgot's share is `forgot:sends:ip`, charged here;
//     the code route charges its own share on every code request before any
//     lookup (see resetSendAllowed), so neither says which addresses exist.
//
// Silent by design: past any of them nothing is mailed and the answer the
// caller already got does not change. A refusal the caller could see would
// say the address has an account. Only a real account reaches this, so
// made-up addresses never spend it.

import { rateLimit } from "@/platform/cache";

export const RESET_SENDS = {
  perAddress: { limit: 3, windowSec: 60 * 60 },
  perCaller: { limit: 10, windowSec: 60 * 60 },
  install: { key: "forgot:sends", limit: 300, windowSec: 60 * 60 },
};

/** May one more reset link be mailed to this address, for this caller? The
 *  caller's share is asked first, so a caller past it spends nothing of the
 *  install's; the address next, so one address cannot spend it either.
 *
 *  `ip: null` skips the caller's share: the emailed-code route charges its own
 *  share on EVERY code request before the lookup (Codex, FOL-315). Charged only
 *  for an unverified account, a shared counter would let a caller learn which
 *  addresses are unverified from whether its own next reset mail arrives. */
export async function resetSendAllowed(email: string, ip: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const addr = email.trim().toLowerCase();
  if (ip && !(await rateLimit(`forgot:sends:ip:${ip}`, RESET_SENDS.perCaller.limit, RESET_SENDS.perCaller.windowSec)).allowed) {
    return { ok: false, error: "this caller's hourly share of reset mail was reached" };
  }
  if (!(await rateLimit(`reset:sends:addr:${addr}`, RESET_SENDS.perAddress.limit, RESET_SENDS.perAddress.windowSec)).allowed) {
    return { ok: false, error: "this address's hourly reset mail limit was reached" };
  }
  if (!(await rateLimit(RESET_SENDS.install.key, RESET_SENDS.install.limit, RESET_SENDS.install.windowSec)).allowed) {
    return { ok: false, error: "the install's hourly reset mail limit was reached" };
  }
  return { ok: true };
}
