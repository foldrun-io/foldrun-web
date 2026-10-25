// Warnings before an API route is switched off.
//
// A route in DEPRECATIONS (api-version.ts) still answers, with Deprecation
// and Sunset headers — which a script reads no more than a person reads a
// log. So an account that called it in the last 30 days hears about it by
// mail, from the platform's usage counts (platform api-usage.ts), with which
// key or person made the calls and how many:
//
//   seen   the first time it is seen calling a deprecated route
//   90d    90 days before the sunset
//   30d    30 days before
//   7d     a week before
//
// One mail per step at most, and only the most urgent one due: an account
// first seen a week before the sunset gets the week's warning, not four.
// A step is marked only once its mail went out, so an outage retries next
// hour. Steps need a sunset date; without one there is only `seen`. After
// the sunset nothing is sent — the route answers no more.
//
// Called hourly from instrumentation.ts under the housekeeping lease (the
// marks make it once even if two replicas both ran). Required mail, the
// `account` category: a thing the account relies on is about to stop.

import { platformMail } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { callersOf, markNoticesSent, noticesSent, pruneApiUsage, type AccountUsage } from "@/platform/api-usage";
import { DEPRECATIONS, type Deprecation } from "./api-version.ts";
import { ownerOf } from "./users.ts";
import { installOrigin } from "@/server/auth-flows";

export const STEPS = [
  { step: "seen", days: Infinity },
  { step: "90d", days: 90 },
  { step: "30d", days: 30 },
  { step: "7d", days: 7 },
] as const;

type Send = (tenant: string, to: string, subject: string, text: string) => Promise<boolean>;

const resend: Send = async (tenant, to, subject, text) => {
  const mail = platformMail(tenant);
  if (!mail) return false;
  return (await sendMail({ tenant, mail, to, subject, text, category: "account" })).ok;
};

const DAY = 86_400_000;
const date = (iso: string) => new Date(iso).toUTCString().slice(0, 16);

/** The steps due for a deprecation today, in order; [] once it is past. */
export function stepsDue(d: Pick<Deprecation, "sunsetAt">, now: number): string[] {
  if (!d.sunsetAt) return ["seen"];
  const left = Math.ceil((Date.parse(d.sunsetAt) - now) / DAY);
  if (left <= 0) return [];
  return STEPS.filter((s) => left <= s.days).map((s) => s.step);
}

export function deprecationNotice(
  tenant: string,
  d: Pick<Deprecation, "route" | "deprecatedAt" | "sunsetAt" | "link">,
  use: AccountUsage["deprecated"][number],
  now: number,
  origin = installOrigin(),
) {
  const left = d.sunsetAt ? Math.ceil((Date.parse(d.sunsetAt) - now) / DAY) : null;
  const when = d.sunsetAt ? `stops answering on ${date(d.sunsetAt)}${left !== null ? ` — in ${left} day${left === 1 ? "" : "s"}` : ""}` : "will be switched off; the date is not set yet";
  const callers = use.callers
    .slice(0, 10)
    .map((c) => `  - ${c.credential || "an unknown caller"}: ${c.requests} request${c.requests === 1 ? "" : "s"}, last ${date(c.lastSeen)}`)
    .join("\n");
  return {
    subject: d.sunsetAt ? `foldrun API: ${d.route} stops working ${date(d.sunsetAt)}` : `foldrun API: ${d.route} is deprecated`,
    text:
      `The account "${tenant}" still calls ${d.route}, which was deprecated on ${date(d.deprecatedAt)} and ${when}.\n\n` +
      `In the last 30 days it was called ${use.requests} time${use.requests === 1 ? "" : "s"}, by:\n${callers}\n\n` +
      (d.link ? `What replaces it: ${d.link}\n\n` : "") +
      `Every response from it carries Deprecation and Sunset headers. Your use of the API, and of this route, is in\n` +
      `  ${origin ? `${origin}/dashboard/settings#api` : "Settings → API, on the dashboard"}\n` +
      `  foldrun api version\n\n` +
      `Once nothing calls it, there is nothing more to do; these warnings stop.\n`,
  };
}

/**
 * Mail the owner of every account that called a deprecated route in the last
 * 30 days and has not had the step now due. Returns how many were sent. Also
 * drops usage rows past their keeping, on the same hourly beat.
 */
export async function warnDeprecatedCallers(now = Date.now(), send: Send = resend, deprecations: Deprecation[] = DEPRECATIONS): Promise<number> {
  let sent = 0;
  for (const d of deprecations) {
    const due = stepsDue(d, now);
    if (!due.length) continue;
    for (const [tenant, use] of await callersOf(d.route, 30, new Date(now))) {
      const have = await noticesSent(tenant, d.route);
      const owed = due.filter((s) => !have.has(s));
      if (!owed.length) continue;
      const owner = await ownerOf(tenant);
      if (!owner?.email) continue;
      const { subject, text } = deprecationNotice(tenant, d, use, now);
      if (await send(tenant, owner.email, subject, text)) {
        // The most urgent step went out; the earlier ones it covers are spent too.
        await markNoticesSent(tenant, d.route, owed, new Date(now));
        sent++;
      }
    }
  }
  await pruneApiUsage(new Date(now)).catch((err) => console.error("[api-usage] prune failed:", err));
  return sent;
}
