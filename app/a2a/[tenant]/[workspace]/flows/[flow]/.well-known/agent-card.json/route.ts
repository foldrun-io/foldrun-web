// GET /a2a/<account>/<workspace>/flows/<flow>/.well-known/agent-card.json —
// the flow's A2A agent card: with an A2A key that names the flow, or without
// one when the flow says `a2a: { public_card: true }`. 404 for a flow that is
// not published (server/a2a-service.ts).

import type { NextRequest } from "next/server";
import { serveCard } from "@/server/a2a-service";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tenant: string; workspace: string; flow: string }> }) {
  return serveCard(req, await ctx.params);
}
