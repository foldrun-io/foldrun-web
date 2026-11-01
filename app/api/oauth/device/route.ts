// Connect with a code instead of a redirect (RFC 8628): for a saved app whose
// provider has a device authorization endpoint. The answer is the user code
// and the page to type it on; a person opens that page on any device, and the
// caller polls POST /api/oauth/device/<id> until the grant is stored as
// `secret` — exactly as a browser consent would store it.
//
//   POST { client, secret, workspace?, scopes? }
//     → { id, user_code, verification_uri, verification_uri_complete?, expires_in, interval }

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { assertMayWriteSecret } from "@/server/secret-writes";
import { getOAuthClient } from "@/platform/oauth-clients";
import { startDeviceConnect } from "@/platform/oauth-connect";
import { scopesOf } from "@/server/oauth-scopes";
import { idempotent } from "@/server/idempotency";
import { audit } from "@/server/audit";

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json().catch(() => ({}))) as { client?: unknown; secret?: unknown; workspace?: unknown; scopes?: unknown };
    if (typeof body.client !== "string" || typeof body.secret !== "string") return refuse("expected { client, secret }", 400);
    // A workspace that is not a string is refused, never read as "the account".
    if (body.workspace !== undefined && body.workspace !== null && typeof body.workspace !== "string") return refuse("workspace is a workspace's name", 400);
    const workspace = typeof body.workspace === "string" && body.workspace ? body.workspace : undefined;
    const scopes = scopesOf(body.scopes);
    if (scopes instanceof Error) return refuse(scopes.message, 400);
    // The grant is stored by a later poll with no caller to ask: the name is
    // checked now, as PUT /api/secrets would check it.
    await assertMayWriteSecret(tenant, actor, body.secret, workspace);
    const config = await getOAuthClient(tenant, body.client);
    if (!config) return refuse(`no saved OAuth client "${body.client}"`, 404);
    const started = await startDeviceConnect(tenant, body.secret, scopes === null ? config : { ...config, scopes }, workspace);
    await audit("oauth.device.started", { actor: actor.name, tenant, subject: body.secret, detail: { client: body.client, ...(workspace ? { workspace } : {}) } });
    return NextResponse.json(started);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
