// One poll of a device authorization started by POST /api/oauth/device: one
// token request to the provider. Poll no faster than `interval` seconds, and
// add five on `slow_down` (RFC 8628 §3.5).
//
//   POST → { status: "pending" | "slow_down" }
//        | { status: "connected", name, workspace?, stored, revoked? }
//        | { status: "denied" | "expired", reason }

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission } from "@/server/api";
import { pollDeviceConnect } from "@/platform/oauth-connect";
import { audit } from "@/server/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const { id } = await ctx.params;
    let r;
    try {
      r = await pollDeviceConnect(tenant, id);
    } catch (err) {
      // The provider timing out or the connection dropping is not an answer:
      // poll again (RFC 8628 §3.5). Anything else is the error it says.
      const name = (err as { name?: unknown })?.name;
      if (err instanceof TypeError || name === "AbortError" || name === "TimeoutError") return NextResponse.json({ status: "pending", retry: true });
      throw err;
    }
    if (r.status === "connected") {
      await audit("secret.set", { actor: actor.name, tenant, subject: r.name, detail: { name: r.name, kind: r.stored, via: "device", ...(r.workspace ? { workspace: r.workspace } : {}) } });
      const { tenant: _t, ...shown } = r;
      return NextResponse.json(shown);
    }
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
