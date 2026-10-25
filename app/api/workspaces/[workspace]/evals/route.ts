import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { workspaceDir, assertSafeName, writeWorkspaceFile, listAgents } from "@/lib/store";
import { listEvals } from "@/lib/evals";
import { idempotent } from "@/server/idempotency";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    return NextResponse.json({ evals: listEvals(await requireTenant(req), workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json()) as { name?: string };
    if (!body.name) return NextResponse.json({ error: "expected { name }" }, { status: 400 });
    assertSafeName(body.name, "eval name");

    const rel = `evals/${body.name}.md`;
    if (fs.existsSync(path.join(workspaceDir(tenant, workspace), rel))) {
      return NextResponse.json({ error: `eval ${body.name} already exists` }, { status: 409 });
    }
    const agent = listAgents(tenant, workspace)[0]?.name ?? "my-agent";
    writeWorkspaceFile(
      tenant,
      workspace,
      rel,
      `---\nname: ${body.name}\nagent: ${agent}\nmodel: fast\n---\n\n` +
        `## it does the thing\ntask: Ask it to do the thing.\nexpect:\n` +
        `  - contains: some text the answer must include\n` +
        `  - judge: the answer actually does what was asked\n`,
    );
    return NextResponse.json({ ok: true, path: rel });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
