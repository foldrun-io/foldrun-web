// Run the consent flow from a saved OAuth client: name the client, name the
// secret the result should become, get back the provider's authorize URL.
// Clients are saved first (POST /api/oauth/clients) and run any number of
// times — first connect, re-consent, different scopes into a new secret.
// `scopes`, when given, is what this connection asks for instead of the
// client's default; the connection keeps it, so a reconnect asks again for
// the same. One registered app serves every API its provider offers.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, assertWorkspaceScope } from "@/server/api";

import { getOAuthClient } from "@/platform/oauth-clients";
import { idempotent } from "@/server/idempotency";
import { startBound, handoff, inBrowser } from "@/server/oauth-browser";
import { scopesOf } from "@/server/oauth-scopes";

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json().catch(() => ({}))) as {
      client?: string;
      secret?: string;
      workspace?: string;
      scopes?: unknown;
    };
    if (!body.client || !body.secret) {
      return NextResponse.json({ error: "expected { client, secret }" }, { status: 400 });
    }
    const scopes = scopesOf(body.scopes);
    if (scopes instanceof Error) return NextResponse.json({ error: scopes.message }, { status: 400 });
    assertWorkspaceScope(actor, body.workspace || undefined);
    const config = await getOAuthClient(tenant, body.client);
    if (!config) return NextResponse.json({ error: `no saved OAuth client "${body.client}"` }, { status: 404 });

    // A person in a browser: the consent is bound to it (a cookie the
    // callback must see again). A key — the CLI — has no browser here, so it
    // gets a hand-off page where a signed-in person accepts first; the answer
    // is `{ url }` either way, so a CLI that opens it needs no change.
    if (!inBrowser(actor)) return await handoff(req, tenant, actor, { client: body.client, secret: body.secret, workspace: body.workspace || undefined, scopes });
    return await startBound(req, tenant, body.secret, scopes === null ? config : { ...config, scopes }, body.workspace || undefined);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
