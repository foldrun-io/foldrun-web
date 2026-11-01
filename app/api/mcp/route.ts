// POST /api/mcp — the platform as an MCP server (server/mcp.ts), for AI apps
// that connect with an API key: Claude Code, Claude Desktop, Cursor, Codex.
//
// MCP's Streamable HTTP transport, the stateless way: one JSON-RPC message
// per POST, answered with one JSON body (202 and no body for a notification).
// No SSE stream and no session id, so GET and DELETE are not served (Next
// answers them 405, which is what the transport asks for).
//
// A key, Bearer, and nothing else: a session cookie never opens it, so a page
// on another site cannot drive it with a signed-in person's browser. The key
// is checked here first, and then again by every route a tool calls.
// `?readonly=1` offers only the tools that read.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveTenant } from "@/server/auth";
import { publicOrigin } from "@/server/auth-flows";
import { handleMessage, MCP_VERSIONS, rpcRefusal } from "@/server/mcp";

export const dynamic = "force-dynamic";

const AUTH_CHALLENGE = { "www-authenticate": 'Bearer realm="foldrun", error="invalid_token"' };

export async function POST(req: NextRequest) {
  // A browser page elsewhere may not post here: the transport asks servers to
  // check Origin. MCP clients send none; the dashboard has no reason to.
  const origin = req.headers.get("origin");
  if (origin && origin !== publicOrigin(req)) {
    return rpcRefusal(403, `requests from ${origin} are refused — an MCP client connects without an Origin header`);
  }
  if (!/^bearer\s+\S/i.test(req.headers.get("authorization") ?? "")) {
    return rpcRefusal(401, "an API key is required: Authorization: Bearer <key> — Settings → API keys, or `foldrun mcp` with this machine's sign-in", AUTH_CHALLENGE);
  }
  const auth = await resolveTenant(req);
  if (auth.tenant === null) return rpcRefusal(auth.status, auth.message, auth.status === 401 ? AUTH_CHALLENGE : {});

  const version = req.headers.get("mcp-protocol-version");
  if (version && !(MCP_VERSIONS as readonly string[]).includes(version)) {
    return rpcRefusal(400, `MCP-Protocol-Version ${version} is not one this server speaks (${MCP_VERSIONS.join(", ")})`);
  }

  let msg: unknown;
  try {
    msg = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "the body is not JSON" } }, { status: 400 });
  }
  const readOnly = /^(1|true|yes)$/i.test(req.nextUrl.searchParams.get("readonly") ?? "");
  const answer = await handleMessage(req, msg, readOnly);
  if (answer === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(answer, { headers: { "cache-control": "no-store" } });
}
