// A CLI-started consent, accepted by a signed-in person in their browser:
// the hand-off page (/dashboard/connect/<id>) posts here. Only a person —
// never a key — may accept, for the account and workspace the hand-off names;
// the consent that starts is bound to this browser like any other.

import { NextRequest } from "next/server";
import { errorResponse, requirePerson, refuse } from "@/server/api";
import { assertMayWriteSecret } from "@/server/secret-writes";
import { peekHandoff } from "@/platform/oauth-connect";
import { getOAuthClient } from "@/platform/oauth-clients";
import { startBound } from "@/server/oauth-browser";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePerson(req, "secrets:write");
    const { id } = await ctx.params;
    const gone = () => refuse("this connect link expired, was already used, or is for another account — start it again", 404);
    // Authorise against the hand-off before using it up: someone who may not
    // accept it must not be able to spend it for the person who may.
    const seen = await peekHandoff(id);
    if (!seen || seen.tenant !== tenant) return gone();
    // The person accepting is who the secret is written for: they must be
    // allowed to write it (the account's mail sender is the owner's alone).
    await assertMayWriteSecret(tenant, actor, seen.name, seen.workspace);
    const config = await getOAuthClient(tenant, seen.client);
    if (!config) return refuse(`no saved OAuth app "${seen.client}"`, 404);
    // Not used up here: a lost answer to Accept can be retried, giving the
    // same person a new consent in this browser. It is used up when a consent
    // started from it completes (oauth-connect.ts), or after ten minutes.
    return await startBound(req, tenant, seen.name, typeof seen.scopes === "string" ? { ...config, scopes: seen.scopes } : config, seen.workspace, {}, id);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
