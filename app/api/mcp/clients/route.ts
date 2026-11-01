// POST /api/mcp/clients — an admin registers a machine client for /api/mcp
// (part G of the OAuth proposal): no person approves its tokens, it asks the
// token endpoint with grant_type=client_credentials. It holds a standing
// grant — the role, workspaces and access chosen here, never more than the
// admin's own, and capped by the admin's again at every use, as a key is —
// listed with the connected apps (GET /api/mcp/connections, machine: true)
// and ended with DELETE /api/mcp/connections/<id>, after which its next
// token request is invalid_client.
//
//   POST { name, role?, workspaces?, access?: read|write, token_auth?, jwks?, jwks_uri? }
//     → { client_id, client_secret? (shown once), grant, token_endpoint, token_endpoint_auth_method }

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, refuse, requireCaller } from "@/server/api";
import { publicOrigin } from "@/server/auth-flows";
import { OAuthError, issuerOf, registerMachineClient } from "@/server/mcp-oauth";
import { withinMinter } from "@/server/key-scope";
import { can, ROLES, type Role } from "@/platform/permissions";
import { findUser } from "@/server/users";
import { idempotent } from "@/server/idempotency";

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    if (!can(actor.role, "keys:manage")) return refuse(`your role (${actor.role}) cannot register machine clients — it needs admin`, 403);
    // The grant speaks for a person, checked at every use: the admin's
    // session, or the person a key was minted for.
    const userId = actor.kind === "user" ? actor.id : (await findUser(actor.name))?.id;
    if (!userId) return refuse("a machine client is registered by a person — sign in, or use a key minted by one (`foldrun login`)", 403);
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; role?: unknown; workspaces?: unknown; access?: unknown; token_auth?: unknown; jwks?: unknown; jwks_uri?: unknown };
    if (typeof body.name !== "string" || !body.name.trim()) return refuse("expected { name } — what the machine client is, as people will read it", 400);
    const role = (body.role ?? "viewer") as Role;
    if (!(ROLES as readonly string[]).includes(role)) return refuse(`role is one of ${ROLES.join(", ")}`, 400);
    if (body.workspaces !== undefined && body.workspaces !== null && (!Array.isArray(body.workspaces) || body.workspaces.some((w) => typeof w !== "string"))) return refuse("workspaces is a list of workspace names, or null for all", 400);
    if (body.access !== undefined && body.access !== "read" && body.access !== "write") return refuse("access is read or write", 400);
    const auth = (body.token_auth ?? "client_secret_basic") as string;
    if (!["client_secret_basic", "client_secret_post", "private_key_jwt"].includes(auth)) return refuse("token_auth is client_secret_basic, client_secret_post or private_key_jwt", 400);
    const grant = withinMinter({ role: actor.role, workspaces: actor.workspaces }, { role, workspaces: body.workspaces as string[] | null | undefined });
    const made = await registerMachineClient({
      tenant, userId, email: actor.name, origin: publicOrigin(req),
      name: body.name, role: grant.role, workspaces: grant.workspaces, readOnly: body.access !== "write",
      auth: auth as "client_secret_basic" | "client_secret_post" | "private_key_jwt",
      ...(body.jwks !== undefined ? { jwks: body.jwks } : {}), ...(body.jwks_uri !== undefined ? { jwks_uri: body.jwks_uri } : {}),
    });
    return NextResponse.json({ ...made, token_endpoint: `${issuerOf(publicOrigin(req)).issuer}/api/mcp/oauth/token` }, { status: 201 });
  } catch (err) {
    if (err instanceof OAuthError) return refuse(err.message, err.status === 401 ? 400 : err.status);
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  // The secret is shown once: never kept in the replay cache.
  return idempotent(args[0], () => postOnce(...args), { secretFields: ["client_secret"] });
}
