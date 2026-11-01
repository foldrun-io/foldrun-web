// GET /a2a/<account>/<workspace> — the flows an A2A key may call here, each
// published, with its agent card and endpoint (server/a2a-service.ts). Not an
// A2A operation: a convenience index, as authenticated as the agents it lists.

import type { NextRequest } from "next/server";
import { serveIndex } from "@/server/a2a-service";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tenant: string; workspace: string }> }) {
  return serveIndex(req, await ctx.params);
}
