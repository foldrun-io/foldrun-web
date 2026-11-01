// RFC 9728 for the resource at /api/mcp — the URL a 401 from /api/mcp names
// in WWW-Authenticate's resource_metadata (server/mcp-oauth.ts). The same
// document as at the root.

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
