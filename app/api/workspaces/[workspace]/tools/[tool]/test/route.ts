import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { workspaceTools } from "@/lib/store";
import { libraryTools } from "@/lib/library";
import { testTool } from "@/lib/tool-test";
import { testableHere } from "@/server/tool-test-scope";
import { idempotent } from "@/server/idempotency";

// Call a tool once and report what happened.
//
// Workspace tools shadow account ones by name — the same nearest-wins rule the
// runtime uses, so what gets tested is what an agent would actually call.

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; tool: string }> },
) {
  try {
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const { workspace, tool } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { path?: string; args?: Record<string, string> };

    const def = { ...libraryTools(tenant), ...workspaceTools(tenant, workspace) }[tool];
    if (!def) {
      return NextResponse.json(
        { error: `no tool "${tool}" in this workspace or the account library` },
        { status: 404 },
      );
    }

    const refusal = testableHere(tool);
    if (refusal) return NextResponse.json(refusal);

    return NextResponse.json(await testTool(tenant, workspace, def, { path: body.path, args: body.args }));
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
