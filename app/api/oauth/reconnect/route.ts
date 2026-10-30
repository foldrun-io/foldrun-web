// Reconnect an OAuth secret with the client it was connected with: no client
// id, no secret, no form. Answers the provider's authorize URL; the consent
// lands on /api/oauth/callback, which rewrites the same secret at the same
// scope. `provider` lets a new secret name borrow an existing client. The
// scopes asked for are `scopes` from the body when given, else the ones the
// secret was connected with (its record), else the client's default.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { assertMayWriteSecret } from "@/server/secret-writes";

import { getOAuthClient } from "@/platform/oauth-clients";
import { clientForSecret, scopesForSecret } from "@/platform/oauth-connections";
import { scopesOf } from "@/server/oauth-scopes";
import { idempotent } from "@/server/idempotency";
import { startBound, handoff, inBrowser, callbackUri } from "@/server/oauth-browser";

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json().catch(() => ({}))) as { secret?: string; workspace?: string; provider?: string; scopes?: unknown };
    const asked = scopesOf(body.scopes);
    if (asked instanceof Error) return refuse(asked.message, 400);
    if (!body.secret) return refuse("expected { secret }", 400);
    // The callback rewrites the secret with no caller left to ask: checked
    // now, as PUT /api/secrets would check it (server/secret-writes.ts).
    await assertMayWriteSecret(tenant, actor, body.secret, body.workspace);
    if (body.provider !== undefined && typeof body.provider !== "string") return refuse("provider is a saved OAuth client's name", 400);
    const client = await clientForSecret(tenant, body.secret, body.workspace || undefined, body.provider);
    const config = client ? await getOAuthClient(tenant, client) : null;
    if (!client || !config) {
      return NextResponse.json(
        { error: `no saved OAuth client for ${body.secret} — connect it once with its client id and secret`, needsClient: true },
        { status: 404 },
      );
    }
    const scopes = asked ?? (await scopesForSecret(tenant, body.secret, body.workspace || undefined));
    const extra = { client, redirectUri: callbackUri(req), ...(scopes !== null ? { scopes } : {}) };
    if (!inBrowser(actor)) {
      const res = await handoff(req, tenant, actor, { client, secret: body.secret, workspace: body.workspace || undefined, scopes });
      return NextResponse.json({ ...(await res.json()), ...extra });
    }
    return await startBound(req, tenant, body.secret, scopes === null ? config : { ...config, scopes }, body.workspace || undefined, extra);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
