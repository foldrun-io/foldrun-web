import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission, actorOf } from "@/server/api";
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
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    // description and model are optional: the canvas's "New agent" asks
    // for them, so the file lands answering the two questions a template
    // otherwise leaves as placeholders.
    const body = (await req.json()) as { name?: string; description?: string; model?: string };
    if (!body.name) return NextResponse.json({ error: "expected { name }" }, { status: 400 });
    assertSafeName(body.name, "agent name");
    const rel = `agents/${body.name}/agent.md`;
    if (fs.existsSync(path.join(workspaceDir(tenant, workspace), rel))) {
      return NextResponse.json({ error: `agent ${body.name} already exists` }, { status: 409 });
    }
    const content = newAgentFile(AGENT_TEMPLATE(body.name), {
      description: typeof body.description === "string" ? body.description : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    writeWorkspaceFile(tenant, workspace, rel, content, { by: await actorOf(req) });
    return NextResponse.json({ ok: true, path: rel });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
