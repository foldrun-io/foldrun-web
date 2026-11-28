// What an account hears about its invites (FOL-464): the one who made an
// invite is mailed when it is accepted, declined, or runs out unused, once
// each; all three are in the audit log. Never the reason a link was dead,
// and nothing to someone who has since left the account.

import type { InviteRow } from "@/platform/invites.ts";
import { platformSend } from "./email";
import { audit } from "./audit";
import { claimExpiredInvites, releaseExpiredInvite, findMember } from "./users";

export type InviteOutcome = "accepted" | "declined" | "expired";

const SENTENCE: Record<InviteOutcome, (who: string, account: string) => string> = {
  accepted: (who, account) => `${who} accepted your invite and is now in the account "${account}".`,
  declined: (who, account) => `${who} declined your invite to the account "${account}". Nothing was changed; invite them again if this was a mistake.`,
  expired: (who, account) => `Your invite to ${who} for the account "${account}" ran out after 7 days without being used. Make a new one if they still need to come in.`,
};

/** Tell the invite's maker how it ended: "sent", "nobody" when they have
 *  left the account (there is no one to tell), or "failed" when the mail
 *  could not go. Never throws: the outcome itself already happened, and a
 *  mail that cannot be sent must not undo it. */
export async function tellInviter(row: Pick<InviteRow, "tenant" | "email" | "createdBy" | "createdByEmail">, outcome: InviteOutcome): Promise<"sent" | "nobody" | "failed"> {
  try {
    const maker = await findMember(row.tenant, { id: row.createdBy });
    if (!maker) return "nobody";
    const who = row.email ?? "someone with the link";
    const sent = await platformSend(row.tenant, maker.email, `Invite ${outcome}: ${who}`, `${SENTENCE[outcome](who, row.tenant)}\n`, undefined, "invites");
    return sent.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** How long after it ran out a notice whose mail failed is tried again. */
const RETRY_MS = 6 * 3_600_000;

/** The hourly beat (instrumentation.ts): invites that ran out unused are
 *  written to the audit log and their makers told. Taken ONE at a time, so
 *  a worker that dies loses at most the one in its hands. Each is audited
 *  whether or not the mail went (`told`); one whose mail failed is handed
 *  back and tried again by later beats for six hours, then left. */
export async function noticeExpiredInvites(max = 50): Promise<number> {
  let told = 0;
  const failed = new Set<string>();
  for (let i = 0; i < max; i++) {
    const [row] = await claimExpiredInvites(1, [...failed]);
    if (!row) break;
    const outcome = await tellInviter(row, "expired");
    await audit("member.invite_expired", { actor: "system", tenant: row.tenant, subject: row.email, detail: { inviteId: row.id, role: row.role, invitedBy: row.createdByEmail, told: outcome } });
    if (outcome === "failed" && Date.now() - Date.parse(row.expiresAt) < RETRY_MS) {
      failed.add(row.id);
      await releaseExpiredInvite(row.id).catch(() => {});
      continue;
    }
    if (outcome !== "failed") told++;
  }
  return told;
}
