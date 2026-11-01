// The person's half of the MCP OAuth sign-in (server/mcp-oauth.ts). The page
// at /mcp/authorize, opened by the AI app with its request in the query,
// asks GET here what the request is — the app, where the answer goes, what it
// asks for, the person's workspaces — then POSTs the person's answer and
// sends the browser on to the redirect this returns: the app's own URI with a
// one-time code, or with error=access_denied.
//
// A signed-in person only: a key never approves an app (it cannot act for a
// person), and a support view never does. The request is checked again on the
// POST — the page is not trusted to carry it faithfully.

import { NextRequest, NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/store";
import { errorResponse, refuse, sessionUser } from "@/server/api";
import { publicOrigin } from "@/server/auth-flows";
import { jsonObject } from "@/server/body";
import { checkAuthorizeRequest, issuerOf, issueCode, OAuthError, redirectWith } from "@/server/mcp-oauth";
import { allowedWorkspaces, roleOfUser } from "@/server/users";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

const QUERY_MAX = 8000;

/** The request's own failure: shown (never redirected), or sent back to the app. */
function failure(err: unknown, q: URLSearchParams, origin: string): NextResponse {
  if (err instanceof OAuthError && (err as OAuthError & { redirect?: boolean }).redirect) {
    const uri = q.get("redirect_uri");
    if (uri) {
      return NextResponse.json({
        error: err.message,
        redirect: redirectWith(uri, { error: err.code, error_description: err.message, state: q.get("state"), iss: issuerOf(origin).issuer }),
      });
    }
  }
  if (err instanceof OAuthError) return refuse(`this app's sign-in request cannot be used: ${err.message}`, 400);
  return errorResponse(err);
}

async function person(req: NextRequest) {
  const user = await sessionUser(req);
  if (user instanceof Response) return { refused: user as NextResponse };
  if (!user) return { refused: refuse("sign in first", 401) };
  const role = (await roleOfUser(user.tenant, user.id)) ?? "viewer";
  const allowed = await allowedWorkspaces(user.tenant, user.id);
  const workspaces = listWorkspaces(user.tenant).map((w) => w.name).filter((w) => allowed === null || allowed.includes(w));
  return { user, role, allowed, workspaces };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("request") ?? "";
  if (raw.length > QUERY_MAX) return refuse("the sign-in request is too long", 400);
  const q = new URLSearchParams(raw);
  const origin = publicOrigin(req);
  try {
    const p = await person(req);
    if ("refused" in p) return p.refused;
    const r = await checkAuthorizeRequest(q, origin);
    const redirect = new URL(r.redirectUri);
    return NextResponse.json({
      client: { name: r.client.client_name, id: r.client.client_id, kind: r.client.kind, uri: r.client.client_uri ?? null },
      redirectHost: redirect.host,
      loopback: redirect.protocol === "http:",
      scopes: r.scope,
      account: p.user.tenant,
      person: { email: p.user.email, role: p.role },
      workspaces: p.workspaces,
      allWorkspaces: p.allowed === null,
    });
  } catch (err) {
    return failure(err, q, origin);
  }
}

export async function POST(req: NextRequest) {
  const origin = publicOrigin(req);
  let q = new URLSearchParams();
  try {
    const p = await person(req);
    if ("refused" in p) return p.refused;
    const body = await jsonObject(req);
    if (typeof body.request !== "string" || body.request.length > QUERY_MAX) return refuse("expected { request, decision, access?, workspaces? }", 400);
    q = new URLSearchParams(body.request);
    const r = await checkAuthorizeRequest(q, origin);
    const iss = issuerOf(origin).issuer;
    if (body.decision === "deny") {
      return NextResponse.json({ ok: true, redirect: redirectWith(r.redirectUri, { error: "access_denied", error_description: "the person said no", state: r.state, iss }) });
    }
    if (body.decision !== "approve") return refuse('expected { decision: "approve" | "deny" }', 400);
    const access = body.access ?? (r.scope.includes("mcp:write") ? "write" : "read");
    if (access !== "read" && access !== "write") return refuse('access is "read" or "write"', 400);
    if (access === "write" && !r.scope.includes("mcp:write")) return refuse("the app asked to read only — it cannot be given more", 400);
    // Never wider than the person: a list is checked against what they may open.
    let workspaces: string[] | null = p.allowed;
    if (body.workspaces !== undefined && body.workspaces !== null) {
      if (!Array.isArray(body.workspaces) || !body.workspaces.length || body.workspaces.some((w) => typeof w !== "string")) return refuse("workspaces is a list of names, or null for all you may open", 400);
      const unknown = (body.workspaces as string[]).filter((w) => !p.workspaces.includes(w));
      if (unknown.length) return refuse(`not a workspace you may open: ${unknown.join(", ")}`, 403);
      workspaces = body.workspaces as string[];
    }
    const code = await issueCode(r, { tenant: p.user.tenant, userId: p.user.id, email: p.user.email, role: p.role, workspaces, readOnly: access === "read" });
    await audit("mcp.connected", {
      actor: p.user.email,
      tenant: p.user.tenant,
      subject: r.client.client_name,
      detail: { client: r.client.client_id, redirectHost: new URL(r.redirectUri).host, access, workspaces: workspaces ?? "all" },
    });
    return NextResponse.json({ ok: true, redirect: redirectWith(r.redirectUri, { code, state: r.state, iss }) });
  } catch (err) {
    return failure(err, q, origin);
  }
}
