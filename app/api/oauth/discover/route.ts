// Discovery from an issuer: the provider's own metadata (RFC 8414 / OpenID
// Connect Discovery) read for the caller, so a saved app's authorize, token,
// revocation, device and PAR URLs are filled in rather than typed. Nothing is
// saved: the Connections form and `foldrun secrets clients add --issuer` show
// what was found and save it with the app.
//
//   POST { issuer, has_secret?, pkce?, token_auth? } → { config }
//
// The document's issuer must equal the one asked for (RFC 8414 §3.3), every
// endpoint must be https, and a server that lists its PKCE methods without
// S256 is refused unless pkce is false. The fetch goes through the SSRF guard.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { discoverOAuth, issuerProblem } from "@/lib/oauth-discovery";
import { parseTokenAuth } from "@/lib/oauth-token";
import { fetchPublic } from "@/platform/ssrf";

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "secrets:write");
    const body = (await req.json().catch(() => ({}))) as { issuer?: unknown; has_secret?: unknown; pkce?: unknown; token_auth?: unknown };
    if (typeof body.issuer !== "string" || !body.issuer.trim()) return refuse("expected { issuer } — the provider's issuer URL, like https://login.example.com", 400);
    const issuer = body.issuer.trim();
    const problem = issuerProblem(issuer);
    if (problem) return refuse(problem, 400);
    let tokenAuth: ReturnType<typeof parseTokenAuth> | undefined;
    if (body.token_auth !== undefined) {
      tokenAuth = typeof body.token_auth === "string" ? parseTokenAuth(body.token_auth) : null;
      if (!tokenAuth) return refuse("token_auth is client_secret_post, client_secret_basic or none", 400);
    }
    try {
      const found = await discoverOAuth(issuer, (url, init) => fetchPublic(url, init, { maxBytes: 256 * 1024 }), {
        hasSecret: body.has_secret !== false,
        ...(body.pkce === false ? { pkce: false } : {}),
        ...(tokenAuth ? { tokenAuth } : {}),
      });
      return NextResponse.json({ config: found });
    } catch (err) {
      // What the provider's server said is the answer, not a fault of ours.
      return refuse(err instanceof Error ? err.message : String(err), 422);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
