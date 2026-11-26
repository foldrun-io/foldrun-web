// How long a mailed link works, and how every sentence says so. The token's
// expiry (auth-tokens.ts), its mails (email.ts) and the pages that name it
// read the same constant from here, so changing a lifetime changes the words
// with it. (The emailed sign-in code's own is code-lifetime.ts.)
// No imports: a client component may read it.

/** A password-reset link (also the set-password link a new account is mailed). */
export const RESET_TTL_MS = 30 * 60 * 1000;
/** An address-confirmation link, and the link that moves a login to a new address. */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** A sign-up link mailed to one address. */
export const SIGNUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A lifetime as people say it, in the largest unit that divides it evenly:
 *  "30 minutes", "1 minute", "24 hours", "7 days", "90 seconds". */
export function lifetimeText(ms: number): string {
  const s = Math.round(ms / 1000);
  // A day is said as hours until it is two ("24 hours", "7 days").
  for (const [unit, size, from] of [["day", 86400, 2], ["hour", 3600, 1], ["minute", 60, 1]] as const) {
    if (s >= size * from && s % size === 0) {
      const n = s / size;
      return `${n} ${unit}${n === 1 ? "" : "s"}`;
    }
  }
  return `${s} ${s === 1 ? "second" : "seconds"}`;
}

export const RESET_LIFETIME_TEXT = lifetimeText(RESET_TTL_MS);
export const VERIFY_LIFETIME_TEXT = lifetimeText(VERIFY_TTL_MS);
export const SIGNUP_LINK_LIFETIME_TEXT = lifetimeText(SIGNUP_LINK_TTL_MS);
