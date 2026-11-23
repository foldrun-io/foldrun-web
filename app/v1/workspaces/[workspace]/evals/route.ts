import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireTenant, errorResponse, requirePermission, actorOf, refuse } from "@/server/api";
import { workspaceDir, assertSafeName, writeWorkspaceFile, listAgents } from "@/lib/store";
import { listEvals } from "@/lib/evals";
import { requireWorkspace } from "@/lib/storage";
import { idempotent } from "@/server/idempotency";
import { jsonObject } from "@/server/body";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    // A name with no workspace is a 404 as on its siblings (vocabulary, runtimes,
    // proposals, storage), not an empty list that reads as "nothing here".
    requireWorkspace(tenant, workspace);
    return NextResponse.json({ evals: listEvals(tenant, workspace) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await jsonObject(req)) as { name?: string };
    if (!body.name) return refuse("expected { name }", 400);
    assertSafeName(body.name, "eval name");

    const rel = `evals/${body.name}.md`;
    if (fs.existsSync(path.join(workspaceDir(tenant, workspace), rel))) {
      return refuse(`eval ${body.name} already exists`, 409);
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
      { by: await actorOf(req) },
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
