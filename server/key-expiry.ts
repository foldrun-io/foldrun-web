// A week's notice before an API key stops working.
//
// A key with an end date is a CI job that will fail on a known day. The
// owner hears about it seven days ahead, once per key, by the platform's
// mail — and can rotate it in a click before anything breaks.
//
// Called on a timer from instrumentation.ts, under the housekeeping lease so
// two replicas do not both mail; the per-key `expiryWarnedAt` mark is what
// makes it once even if they did.

import { platformMail } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { expiringKeys, markExpiryWarned, type ApiKeyRecord } from "./auth.ts";
import { ownerOf } from "./users.ts";
import { installOrigin } from "@/server/auth-flows";

export const WARN_BEFORE_MS = 7 * 86_400_000;

type Send = (tenant: string, to: string, subject: string, text: string) => Promise<boolean>;

// Through core's sendMail as `security` mail: a key about to stop working is
// the account's safety, so it is always sent — a preference cannot turn it off.
const resend: Send = async (tenant, to, subject, text) => {
  const mail = platformMail(tenant);
  if (!mail) return false;
  return (await sendMail({ tenant, mail, to, subject, text, category: "security" })).ok;
};

export function expiryNotice(k: Pick<ApiKeyRecord, "label" | "prefix" | "expiresAt" | "tenant">, origin = installOrigin()) {
  const day = new Date(k.expiresAt!).toUTCString().slice(0, 16);
  return {
    subject: `Your foldrun API key "${k.label}" expires ${day}`,
    text:
      `The API key "${k.label}" (${k.prefix}…) on the account "${k.tenant}" stops working on ${day}.\n\n` +
      `Anything that uses it — a CI job, a script, a laptop — will be refused from then on. ` +
      `Rotate it to get a new key with the same role and workspaces, and keep the old one working for an hour or a day while you swap it in:\n\n` +
      `  ${origin ? `${origin}/dashboard/settings#api-keys` : "Settings → API keys, on the dashboard"}\n` +
      `  foldrun keys rotate <id> --grace 24h\n\n` +
      `If nothing uses it any more, let it lapse — there is nothing to do.\n`,
  };
}

/**
 * Mail the owner of every live key that ends within a week and has not been
 * warned. A key is marked only when the mail went out, so a mail outage is
 * retried next time rather than silently skipped. Returns how many were sent.
 */
export async function warnExpiringKeys(now = Date.now(), send: Send = resend): Promise<number> {
  let sent = 0;
  for (const k of await expiringKeys(new Date(now + WARN_BEFORE_MS))) {
    if (!k.expiresAt || Date.parse(k.expiresAt) <= now) continue; // already over: nothing to warn about
    const owner = await ownerOf(k.tenant);
    if (!owner?.email) continue;
    const { subject, text } = expiryNotice(k);
    if (await send(k.tenant, owner.email, subject, text)) {
      await markExpiryWarned(k.id, new Date(now));
      sent++;
    }
  }
  return sent;
}
