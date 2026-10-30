// The public keys identity tokens are signed with (platform oidc-issuer.ts):
// every key not yet retired, a new one a day before it signs. Public parts
// only. Open, cacheable; 404 when the install does not issue tokens.

import { NextResponse } from "next/server";
import { oidcIssuer, oidcJwks } from "@/platform/oidc-issuer";
import { refuse } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!oidcIssuer()) return refuse("this install does not issue identity tokens", 404);
  return NextResponse.json(await oidcJwks(), { headers: { "cache-control": "public, max-age=300" } });
}
