import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission, actorOf, refuse } from "@/server/api";
import { assertMayChangeWorkspacePolicy, auditPolicyEvents } from "@/server/workspace-policy";
import fs from "node:fs";
import path from "node:path";
import { workspaceDir, assertSafeName, writeWorkspaceFile, AGENT_TEMPLATE } from "@/lib/store";
import { newAgentFile } from "@/lib/flow-patterns";
import { idempotent } from "@/server/idempotency";
import { agentsWithActivity } from "@/server/agent-activity";

// What is deployed here. The dashboard reads this straight off disk in a
// server component, so this route existed only to *create* an agent — which
// left a caller who deployed over HTTP with no way to ask what landed.
export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // With when each last ran and whether it is past alerts: stale_days.
    return NextResponse.json({ agents: agentsWithActivity(await requireTenant(req), workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}


async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    // description and model are optional: the canvas's "New agent" asks
    // for them, so the file lands answering the two questions a template
    // otherwise leaves as placeholders.
    const body = (await req.json()) as { name?: string; description?: string; model?: string };
    if (!body.name) return refuse("expected { name }", 400);
    assertSafeName(body.name, "agent name");
    const rel = `agents/${body.name}/agent.md`;
    if (fs.existsSync(path.join(workspaceDir(tenant, workspace), rel))) {
      return refuse(`agent ${body.name} already exists`, 409);
    }
    const content = newAgentFile(AGENT_TEMPLATE(body.name), {
      description: typeof body.description === "string" ? body.description : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    const by = await actorOf(req);
    // A published flow that names this agent before it exists gains it now:
    // a new agent behind the flow (FOL-112).
    const policyEvents = assertMayChangeWorkspacePolicy(actor, tenant, workspace, [{ path: rel, content }], "merge");
    writeWorkspaceFile(tenant, workspace, rel, content, { by });
    await auditPolicyEvents(policyEvents, actor.name, tenant);
    return NextResponse.json({ ok: true, path: rel });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
