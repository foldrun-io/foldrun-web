// RFC 8414: the MCP OAuth endpoints, PKCE S256 only, registration open and
// Client ID Metadata Documents accepted (server/mcp-oauth.ts). Beside it,
// /.well-known/openid-configuration is the workload-identity issuer's — a
// different thing; MCP clients read this document first.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/auth-flows";
import { authorizationServerMetadata } from "@/server/mcp-oauth";
import { OPEN_CORS, preflight } from "@/server/mcp-oauth-http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(publicOrigin(req)), { headers: { ...OPEN_CORS, "cache-control": "public, max-age=300" } });
}

export const OPTIONS = preflight;
