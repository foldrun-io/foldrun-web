// A project's conversations (FOL-236): every conversation its runs belong
// to, the most recently used first — its id (what `context` names on a run,
// and what `foldrun code --context` takes), how many turns became runs, and
// its last turn. Test runs and outside agents' (A2A) conversations are not
// listed. A turn on a person's own computer makes no run, so a conversation
// held only there is not here. Reading needs a member of the project.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenant } from "@/server/api";
import { requireWorkspace } from "@/lib/storage";
import { listSessions, SESSIONS_LIMIT } from "@/lib/conversation";

type Ctx = { params: Promise<{ workspace: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    requireWorkspace(tenant, workspace);
    const raw = req.nextUrl.searchParams.get("limit");
    const limit = raw && /^\d+$/.test(raw) ? Math.min(SESSIONS_LIMIT, Math.max(1, Number(raw))) : 50;
    return NextResponse.json({ sessions: listSessions(tenant, workspace, limit) });
  } catch (err) {
    return errorResponse(err);
  }
}
