// POST /api/mcp/oauth/revoke — RFC 7009's revocation endpoint for MCP apps:
// an app hands back its access or refresh token and the connection it speaks
// for ends (server/mcp-oauth.ts revokeRequest). The app authenticates as at
// the token endpoint. Form-encoded, as the RFC says; JSON is read too. A 200
// with an empty body for success, and for a token already gone (§2.2).

import { NextResponse, type NextRequest } from "next/server";
import { revokeRequest } from "@/server/mcp-oauth";
import { OPEN_CORS, oauthError, openLimit, preflight } from "@/server/mcp-oauth-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const slow = await openLimit(req, "token");
    if (slow) return slow;
    const type = req.headers.get("content-type") ?? "";
    const raw = await req.text();
    let form: URLSearchParams;
    if (type.includes("application/json")) {
      const o = JSON.parse(raw || "{}") as Record<string, unknown>;
      form = new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string") as [string, string][]);
    } else {
      form = new URLSearchParams(raw);
    }
    await revokeRequest(form, req.headers.get("authorization"));
    // CORS on the answer too: a browser app on another origin reads it.
    return new NextResponse(null, { status: 200, headers: { ...OPEN_CORS, "cache-control": "no-store" } });
  } catch (err) {
    return oauthError(err);
  }
}

export const OPTIONS = preflight;
