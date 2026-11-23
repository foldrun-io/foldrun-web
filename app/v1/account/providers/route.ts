// Whether this account's model providers still take its keys.
//
// GET returns the last daily check, which cost a fraction of a cent and was
// made without anyone asking. POST forces one now, for the moment after
// someone has just rotated a key and wants to know before a desk finds out
// at five in the morning.
//
// A check spends a real model request at each distinct endpoint, so forcing
// one needs the permission that spends rather than the one that reads.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requireAccountWide } from "@/server/api";
import { checkProvidersNow } from "@/platform/watchdog";
import { providerFactsFor } from "@/server/provider-facts";
import { idempotent } from "@/server/idempotency";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // What WOULD be checked, always — so an account that has never been
    // checked still sees which credentials its agents depend on, and an
    // empty list is visibly "you use the platform's own key" rather than
    // an unexplained blank. A scoped caller sees its own workspaces' and
    // the account's (server/provider-facts.ts).
    return NextResponse.json(await providerFactsFor(tenant, actor.workspaces));
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest) {
  try {
    // A check spends a request at every workspace's endpoints: a caller
    // scoped to some workspaces may not spend the others' (30 Oct 2026).
    const { tenant } = await requireAccountWide(req, "run:start");
    return NextResponse.json({ ok: true, lastCheck: await checkProvidersNow(tenant) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
