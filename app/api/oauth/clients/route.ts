// Saved OAuth clients — the user's own registered apps. GET lists metadata
// (never the client_secret); POST saves one; DELETE removes one. Running
// the consent flow from a saved client is /api/oauth/start's job.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requireAccountWide } from "@/server/api";
import { saveOAuthClient, listOAuthClients, deleteOAuthClient } from "@/platform/oauth-clients";
import type { OAuthProviderConfig } from "@/platform/oauth-connect";
import { idempotent } from "@/server/idempotency";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ clients: await listOAuthClients(await requireTenant(req)) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest) {
  try {
    const tenant = (await requireAccountWide(req, "secrets:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      config?: OAuthProviderConfig;
    };
    if (!body.name || !body.config) {
      return NextResponse.json({ error: "expected { name, config }" }, { status: 400 });
    }
    await saveOAuthClient(tenant, body.name, body.config);
    return NextResponse.json({ ok: true, name: body.name });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const tenant = (await requireAccountWide(req, "secrets:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as { client?: string };
    if (!body.client) return NextResponse.json({ error: "expected { client }" }, { status: 400 });
    if (!(await deleteOAuthClient(tenant, body.client))) {
      return NextResponse.json({ error: "no such client" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
