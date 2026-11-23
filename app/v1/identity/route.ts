// What a cloud's trust policy needs to trust this account's keyless
// identities: the issuer, and the subject each agent's tokens carry. Read by
// the Connections form and `foldrun identity`.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { oidcIssuer, TOKEN_SECONDS } from "@/platform/oidc-issuer";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant(req);
    const issuer = oidcIssuer();
    const ws = req.nextUrl.searchParams.get("workspace");
    return NextResponse.json({
      enabled: issuer !== null,
      issuer,
      // Account, workspace and agent, in this order — pin at least the account.
      subject: `account:${tenant}:workspace:${ws || "<workspace>"}:agent:<agent>`,
      tokenSeconds: TOKEN_SECONDS,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
