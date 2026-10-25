import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import fs from "node:fs";
import path from "node:path";
import {
  workspaceDir,
  assertSafeName,
  writeWorkspaceFile,
  listAgents,
  listFlows,
  flowPatternTemplate,
  FLOW_PATTERNS,
  type FlowPattern,
} from "@/lib/store";
import { idempotent } from "@/server/idempotency";

// Same gap as agents/: this route could create a flow but never list one, so
// nothing deployed over HTTP could be discovered over HTTP.
export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    return NextResponse.json({ flows: listFlows(await requireTenant(req), workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json()) as { name?: string; pattern?: string };
    if (!body.name) return NextResponse.json({ error: "expected { name }" }, { status: 400 });
    assertSafeName(body.name, "flow name");
    const pattern: FlowPattern = FLOW_PATTERNS.includes(body.pattern as FlowPattern)
      ? (body.pattern as FlowPattern)
      : "pipeline";
    const rel = `flows/${body.name}.md`;
    if (fs.existsSync(path.join(workspaceDir(tenant, workspace), rel))) {
      return NextResponse.json({ error: `flow ${body.name} already exists` }, { status: 409 });
    }
    const agents = listAgents(tenant, workspace).map((a) => a.name);
    writeWorkspaceFile(tenant, workspace, rel, flowPatternTemplate(pattern, body.name, agents));
    return NextResponse.json({ ok: true, path: rel, pattern });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
