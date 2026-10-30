// The brakes on an assistant job, wherever one is queued for a caller
// (30 Oct 2026). The assistant route had them — a person's hour, the
// platform-paid account's day, the balance — and POST …/evals/<e>/improve
// queues the same job type with none of them, so an editor on an account
// with no funds could alternate improve and dismiss and draft on the
// platform's shared credential. One function, so a third caller cannot
// forget one.

import type { NextResponse } from "next/server";
import { paidByPlatform } from "@/platform/assistant/engine";
import { billing } from "@/platform/billing";
import { refuseWhenLimited } from "@/server/limits";

/** Replies per person (or key) per hour — each is a model call with tools. */
export const ASSISTANT_PER_HOUR = 60;
/** Replies per account per day when the platform's credential pays: those
 *  draw on the one pool every account's runs share, and an assistant must
 *  never be what stalls them. */
export const ASSISTANT_PLATFORM_PER_DAY = 300;

/**
 * A 429 when the account's day (platform-paid only) or the caller's hour is
 * spent, else null — and a 402 thrown (billing's assertFunds) when the
 * platform pays and the balance is empty. The account's day is counted first:
 * a request it refuses must not also spend the person's hour.
 */
export async function refuseAssistantJob(
  tenant: string,
  workspace: string,
  actor: { kind: string; id: string },
): Promise<NextResponse | null> {
  const platformPays = paidByPlatform(tenant, workspace);
  const limited =
    (platformPays ? await refuseWhenLimited(`assistant-day:${tenant}`, ASSISTANT_PLATFORM_PER_DAY, 86_400) : null) ??
    (await refuseWhenLimited(`assistant:${tenant}:${actor.kind}:${actor.id}`, ASSISTANT_PER_HOUR, 3600));
  if (limited) return limited;
  // Money is checked where work is added, as a run's start checks it: an
  // empty wallet is a 402 now, not an error a worker writes later.
  if (platformPays) await billing().assertFunds(tenant);
  return null;
}
