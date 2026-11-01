// POST /api/mcp/oauth/register — RFC 7591: an AI app registers itself before
// a person signs it in (server/mcp-oauth.ts). Open, as the protocol needs; the
// proxy's rate gate and MAX_CLIENTS bound it.

import type { NextRequest } from "next/server";
import { registerClient } from "@/server/mcp-oauth";
import { oauthError, oauthJson, openLimit, preflight } from "@/server/mcp-oauth-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const slow = await openLimit(req, "register");
    if (slow) return slow;
    const body = await req.json().catch(() => null);
    return oauthJson(await registerClient(body), 201);
  } catch (err) {
    return oauthError(err);
  }
}

export const OPTIONS = preflight;
