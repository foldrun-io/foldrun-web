// How many invites go out in a day (FOL-464), so an invite cannot be used
// to flood an inbox: per recipient across the whole install, per inviter
// and per account. A resend counts as a mail like the first, and one
// invite is resent at most once in ten minutes.
//
// A refusal charges nobody: every limit that applies is looked at first,
// and only when all would allow it is each counted. (Two requests at the
// same instant can both pass the look; the count still refuses the one
// past a limit, and that one has then been counted against the others.)
// The counters live in the cache (platform cache.ts): with the cache down
// each copy of the app counts by itself, so a limit is then per copy.

import { rateLimit, rateLimitPeek } from "@/platform/cache.ts";
import { ApiError } from "./api";

const DAY = 86_400;
export const INVITES_PER_RECIPIENT = 3;
export const INVITES_PER_INVITER = 30;
export const INVITES_PER_ACCOUNT = 100;
export const RESEND_WAIT_SEC = 600;

/** One mailbox, exactly: no list, no display name, no bracket. The mailer
 *  reads a comma as a second recipient, and the day's limit counts the
 *  string it is given, so the two must be the same one address. */
export const ONE_MAILBOX = /^[^\s@,;:<>()"\\]+@[^\s@,;:<>()"\\]+\.[^\s@,;:<>()"\\]+$/;

interface Limit {
  key: string;
  limit: number;
  windowSec: number;
  refusal: (retryAfter: number) => string;
}

function limitsFor(tenant: string, inviter: string, email: string | null, resendOf?: string): Limit[] {
  return [
    ...(resendOf ? [{ key: `invite:resend:${resendOf}`, limit: 1, windowSec: RESEND_WAIT_SEC, refusal: (s: number) => `that invite was sent a moment ago — it can be sent again in ${Math.ceil(s / 60)} min` }] : []),
    { key: `invite:inviter:${inviter}`, limit: INVITES_PER_INVITER, windowSec: DAY, refusal: () => `you have made ${INVITES_PER_INVITER} invites today, the most in a day — try again tomorrow` },
    ...(email ? [{ key: `invite:to:${email}`, limit: INVITES_PER_RECIPIENT, windowSec: DAY, refusal: () => "no more invite mail goes to that address today — try again tomorrow, or copy the link and send it yourself" }] : []),
    { key: `invite:account:${tenant}`, limit: INVITES_PER_ACCOUNT, windowSec: DAY, refusal: () => `this account has made ${INVITES_PER_ACCOUNT} invites today, the most in a day — try again tomorrow` },
  ];
}

async function reserve(limits: Limit[]): Promise<void> {
  const over = (l: Limit, retryAfter: number) => Object.assign(new ApiError(l.refusal(retryAfter), 429), { retryAfter });
  for (const l of limits) {
    const now = await rateLimitPeek(l.key, l.limit, l.windowSec);
    if (!now.allowed) throw over(l, now.retryAfter);
  }
  for (const l of limits) {
    const counted = await rateLimit(l.key, l.limit, l.windowSec);
    if (!counted.allowed) throw over(l, counted.retryAfter);
  }
}

/** One more invite by `inviter` in `tenant`, mailed to `email` (null: a link
 *  only, no mail): refused with 429 past a day's limit. */
export async function countInvite(tenant: string, inviter: string, email: string | null): Promise<void> {
  await reserve(limitsFor(tenant, inviter, email));
}

/** A resend of one invite: once in ten minutes, and a mail like any other
 *  against the inviter's, the address's and the account's day. */
export async function countResend(tenant: string, inviter: string, inviteId: string, email: string): Promise<void> {
  await reserve(limitsFor(tenant, inviter, email, inviteId));
}
