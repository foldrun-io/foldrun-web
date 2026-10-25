import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requirePermission, assertWorkspaceScope, actorOf } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces, listAgents } from "@/lib/store";
import { importAgent, AgentImportError } from "@/lib/agent-import";
import { idempotent } from "@/server/idempotency";

// Bring an agent you already have into this workspace — copied from another
// workspace of the same account, its agent.md and own skills/scripts, never
// its memory. See core agent-import.ts.

/** What could be imported here: every other workspace this caller may read,
 *  and its agents. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    const workspaces = listWorkspaces(tenant)
      .filter((w) => w.name !== workspace && scopeAllows(actor.workspaces, w.name))
      .map((w) => ({
        name: w.name,
        agents: listAgents(tenant, w.name).map((a) => ({ name: a.name, description: a.description ?? "" })),
      }))
      .filter((w) => w.agents.length > 0);
    return NextResponse.json({ workspaces });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // Writing here needs write on this workspace; the path names it, so the
    // scope check in requirePermission covers it. The SOURCE is in the body,
    // which that check cannot see — a caller scoped to some workspaces must
    // not copy out of one they were not given.
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    const body = (await req.json().catch(() => ({}))) as { from?: unknown; agent?: unknown; as?: unknown };
    if (typeof body.from !== "string" || typeof body.agent !== "string" || !body.from || !body.agent) {
      return NextResponse.json({ error: "expected { from: <workspace>, agent: <name>, as?: <new name> }" }, { status: 400 });
    }
    assertWorkspaceScope(actor, body.from);
    const by = await actorOf(req);
    const result = importAgent(tenant, body.from, body.agent, workspace, {
      ...(typeof body.as === "string" && body.as.trim() ? { as: body.as.trim() } : {}),
      ...(by ? { by } : {}),
    });
    return NextResponse.json({ ok: true, from: body.from, ...result });
  } catch (err) {
    if (err instanceof AgentImportError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
