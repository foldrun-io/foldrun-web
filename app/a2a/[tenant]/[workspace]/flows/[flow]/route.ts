// POST /a2a/<account>/<workspace>/flows/<flow> — the flow's A2A 1.0 endpoint:
// JSON-RPC 2.0 (SendMessage, GetTask, ListTasks, CancelTask; the methods the
// agent does not serve are answered with the error the spec names). An A2A
// key only (server/a2a-service.ts).

import type { NextRequest } from "next/server";
import { serveRpc } from "@/server/a2a-service";

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenant: string; workspace: string; flow: string }> }) {
  return serveRpc(req, await ctx.params);
}
