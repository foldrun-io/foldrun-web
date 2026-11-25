// Read one webhook's URL without changing it. The settings page has always
// shown it to whoever may manage the workspace; this is the same answer for a
// script or the CLI, which until now could only learn it by rotating — and so
// breaking — the URL it wanted to read.

import { assertActorConfirmed } from "@/server/email-confirmed";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse } from "@/server/api";
import { requireWebhookFlow } from "@/server/webhook-flow";
import { webhookPath, publicUrl } from "@/lib/webhook";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string; flow: string }> }) {
  try {
    // workspace:manage, as for rotate and the settings page: the path carries the token.
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    // The path carries the token, which outlives a password reset (FOL-317).
    await assertActorConfirmed(tenant, actor);
    const { workspace, flow } = await ctx.params;
    requireWebhookFlow(tenant, workspace, flow);
    const path = webhookPath(tenant, workspace, flow);
    const origin = publicUrl();
    return NextResponse.json({ ok: true, flow, path, url: origin ? `${origin}${path}` : null });
  } catch (err) {
    return errorResponse(err);
  }
}
