// POST /api/mcp/oauth/token — OAuth 2.1's token endpoint for MCP apps: an
// authorization code (with its PKCE verifier) for tokens, or a refresh token
// for new ones, rotated (server/mcp-oauth.ts). Form-encoded, as RFC 6749 says;
// JSON is read too.

import type { NextRequest } from "next/server";
import { publicOrigin } from "@/server/auth-flows";
import { tokenRequest } from "@/server/mcp-oauth";
import { oauthError, oauthForm, oauthJson, openLimit, preflight } from "@/server/mcp-oauth-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const slow = await openLimit(req, "token");
    if (slow) return slow;
    const form = await oauthForm(req);
    return oauthJson(await tokenRequest(form, req.headers.get("authorization"), publicOrigin(req)));
  } catch (err) {
    return oauthError(err);
  }
}

export const OPTIONS = preflight;
