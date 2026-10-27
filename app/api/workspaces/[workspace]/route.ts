import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { audit } from "@/server/audit";
import fs from "node:fs";
import {
  workspaceDir,
  deleteWorkspace,
  renameWorkspace,
  renameImpact,
  setWorkspaceDescription,
  listAgents,
  listFlows,
  listWorkspaceFiles,
} from "@/lib/store";
import { readWorkspaceFile, writeWorkspaceFile } from "@/lib/store";
import { patchFrontmatter, readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsPatch, defaultsOf, WORKSPACE_PATCHABLE } from "@/components/defaults-model";
import { configMatter } from "@/lib/matter";
import { adminState, workspacePause } from "@/platform/admin";

async function tenantOf(req: NextRequest) {
  return await requireTenant(req);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await tenantOf(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return NextResponse.json({ error: "workspace not found" }, { status: 404 });
    }
    return NextResponse.json({
      name: workspace,
      agents: listAgents(tenant, workspace),
      flows: listFlows(tenant, workspace),
      files: listWorkspaceFiles(tenant, workspace),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    deleteWorkspace(tenant, workspace);
    await audit("workspace.deleted", { actor: actor.name, tenant, subject: workspace, detail: { workspace } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Rename a workspace, change its description, or both.
 *
 * A rename changes every webhook URL for this workspace *and* the token inside
 * them, so the response reports which flows were affected. The caller is
 * expected to show that; silently breaking a live integration is exactly the
 * kind of quiet failure this project keeps producing.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:manage")).tenant;
    const body = (await req.json()) as { name?: string; description?: string; timezone?: unknown; budget?: unknown; notify?: unknown; network_enforce?: unknown };

    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return NextResponse.json({ error: "workspace not found" }, { status: 404 });
    }

    // Description first: after a rename the old name no longer resolves.
    if (typeof body.description === "string") {
      setWorkspaceDescription(tenant, workspace, body.description);
    }
    // The defaults — timezone, budget, notify, network_enforce — edited as
    // frontmatter keys in place, through the writer that records a revision.
    if (WORKSPACE_PATCHABLE.some((k) => k in body)) {
      let before = "";
      try {
        before = readWorkspaceFile(tenant, workspace, "AGENTS.md");
      } catch {
        before = "";
      }
      // Only the keys a workspace's settings may write: a body that also
      // carried an account-only key (concurrency, telemetry, deploy_block)
      // used to pass it through to the workspace's file (Codex review).
      const scoped = Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => (WORKSPACE_PATCHABLE as readonly string[]).includes(k)));
      let current: Record<string, unknown> = {};
      try {
        current = (configMatter(before).data ?? {}) as Record<string, unknown>;
      } catch {
        // unreadable frontmatter: nothing to merge over; the write says so
      }
      const patch = defaultsPatch(scoped, current);
      if ("error" in patch) return NextResponse.json({ error: patch.error }, { status: 400 });
      writeWorkspaceFile(tenant, workspace, "AGENTS.md", patchFrontmatter(before, patch.keys), { message: `settings: ${Object.keys(patch.keys).join(", ")}` });
    }

    let renamedTo: string | null = null;
    let brokeWebhooks: string[] = [];
    if (body.name && body.name !== workspace) {
      // The pause is kept by name: a rename would quietly release it, so a
      // paused workspace is resumed first, on purpose (Codex review).
      const held = workspacePause(await adminState(tenant), workspace);
      if (held && !held.resumedAt) {
        return NextResponse.json({ error: `${workspace} is paused — resume it before renaming it, so the rename does not quietly lift the pause` }, { status: 409 });
      }
      brokeWebhooks = renameImpact(tenant, workspace).webhookFlows;
      renameWorkspace(tenant, workspace, body.name);
      renamedTo = body.name;
    }

    return NextResponse.json({
      ok: true,
      name: renamedTo ?? workspace,
      renamed: renamedTo !== null,
      defaults: defaultsOf(readAgentsMdKeys(workspaceDir(tenant, renamedTo ?? workspace))),
      /** Webhook URLs that stopped working. Re-copy them from each flow. */
      brokeWebhooks,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
