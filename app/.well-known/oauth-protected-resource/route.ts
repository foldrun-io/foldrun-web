// RFC 9728 at the root: what /api/mcp is and who signs in for it — for an MCP
// client that looks here before the path-specific document (server/mcp-oauth.ts).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/auth-flows";
import { protectedResourceMetadata } from "@/server/mcp-oauth";
import { OPEN_CORS, preflight } from "@/server/mcp-oauth-http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(req)), { headers: { ...OPEN_CORS, "cache-control": "public, max-age=300" } });
}

export const OPTIONS = preflight;
