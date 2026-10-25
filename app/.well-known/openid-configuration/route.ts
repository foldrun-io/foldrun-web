// OIDC discovery for workload federation (platform oidc-issuer.ts): what a
// cloud reads to trust this install's identity tokens. Open — a verifier
// signs in nowhere. 404 when the install does not issue them.

import { NextResponse } from "next/server";
import { oidcIssuer, oidcDiscovery } from "@/platform/oidc-issuer";

export const dynamic = "force-dynamic";

export async function GET() {
  const issuer = oidcIssuer();
  if (!issuer) return NextResponse.json({ error: "this install does not issue identity tokens" }, { status: 404 });
  return NextResponse.json(oidcDiscovery(issuer), { headers: { "cache-control": "public, max-age=300" } });
}
