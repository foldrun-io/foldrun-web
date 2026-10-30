import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requirePermission } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import fs from "node:fs";
import path from "node:path";
import { listWorkspaces, saveWorkspace, listAgents, listFlows, templateFiles, blankTemplateFiles, workspaceDir, type DeployFile } from "@/lib/store";
import { avatarUrl } from "@/platform/avatars";
import { demoWorkspaceFiles, DEMO_WORKSPACE } from "@/platform/demo-workspace";
import { idempotent } from "@/server/idempotency";
import { workspaceCapRefusal } from "@/server/workspace-cap";
import { deployWorkspace } from "@/lib/deploy";
import { audit } from "@/server/audit";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    return NextResponse.json({ workspaces: listWorkspaces(tenant).filter((w) => scopeAllows(actor.workspaces, w.name)).map((w) => ({ ...w, avatar: avatarUrl(tenant, "workspace", w.name) })) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest) {
  try {
    // Refuse before reading the body: a caller who may not do this learns
    // that, not what the body should have looked like.
    await requirePermission(req, "workspace:manage");
    const body = (await req.json()) as {
      name?: string;
      files?: DeployFile[];
      template?: boolean;
      starter?: boolean;
      demo?: boolean;
      /** Create only: refuse with 409 when the name exists, rather than
       *  deploying over it, which is what this POST otherwise does. */
      ifAbsent?: boolean;
    };
    if (body.demo) {
      // The demo pipeline: a working 4-step flow with a parallel pair, an
      // approval gate and a pretend CRM tool. Fixed name so recreating it
      // is idempotent-ish rather than demo-1, demo-2, demo-3.
      body.name = DEMO_WORKSPACE;
      body.files = demoWorkspaceFiles();
    } else if (body.name && body.starter) {
      // The example researcher + writer + publish flow, on request only.
      body.files = templateFiles(body.name);
    } else if (body.name && body.template) {
      // Dashboard "Create workspace": blank — an AGENTS.md and nothing to
      // delete. Agents come from "Import agent" or "New agent" (owner,
      // 2026-10-05: "why does a new workspace have agents?").
      body.files = blankTemplateFiles(body.name);
    }
    if (!body.name || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json({ error: "expected { name, files: [{path, content}] }" }, { status: 400 });
    }
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    // A member scoped to some workspaces may create a new one, never replace
    // the source of one they were not given (the URL names no workspace
    // here, so the usual scope check never sees it).
    if (actor.workspaces !== null && !scopeAllows(actor.workspaces, body.name) && fs.existsSync(workspaceDir(tenant, body.name))) {
      return NextResponse.json({ error: "this workspace is not one you were given access to" }, { status: 403 });
    }
    // The plan's workspace count, for NEW workspaces only — the same check
    // import and a deploy to a new name make (server/workspace-cap.ts).
    const overCap = await workspaceCapRefusal(tenant, body.name);
    if (overCap) return NextResponse.json({ error: overCap }, { status: 402 });
    if (body.ifAbsent === true) {
      // Claimed atomically: a folder made without `recursive` fails when it
      // is there, so two creates of one name cannot both win — listing first
      // and posting after could (the assistant's Create workspace sends this).
      const dir = workspaceDir(tenant, body.name);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      try {
        fs.mkdirSync(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          return NextResponse.json({ error: `a workspace called ${body.name} exists — nothing was changed` }, { status: 409 });
        }
        throw err;
      }
      try {
        saveWorkspace(tenant, body.name, body.files);
      } catch (err) {
        // The name was claimed for this create alone: a save that failed
        // gives it back, or the empty folder would block it for good.
        fs.rmSync(dir, { recursive: true, force: true });
        throw err;
      }
    } else if (fs.existsSync(workspaceDir(tenant, body.name))) {
      // Over a workspace that exists, this POST is a deploy, so it takes the
      // deploy's gate (30 Oct 2026): the checks a deploy refuses on, the
      // refusal while a run is reading the files, and the audit entry.
      // saveWorkspace straight from here skipped all three.
      const result = deployWorkspace(tenant, body.name, body.files);
      if (!result.applied) {
        return NextResponse.json(
          {
            ok: false,
            reason: result.issues.length ? "did not check out" : "runs in flight",
            error: result.issues.length
              ? `${body.name} exists, and these files did not check out — nothing was changed`
              : `${body.name} exists and a run is reading its files — nothing was changed; try again when it ends`,
            issues: result.issues,
            warnings: result.warnings,
            blockedBy: result.blockedBy,
          },
          { status: 422 },
        );
      }
      await audit("workspace.deployed", {
        actor: actor.name,
        tenant,
        subject: body.name,
        detail: { workspace: body.name, commit: null, added: result.added.length, updated: result.updated.length, removed: result.removed.length },
      });
    } else {
      saveWorkspace(tenant, body.name, body.files);
    }
    const agents = listAgents(tenant, body.name);
    const flows = listFlows(tenant, body.name);
    return NextResponse.json({
      ok: true,
      name: body.name,
      tenant,
      agents: agents.length,
      flows: flows.length,
      dashboard: `/dashboard/${body.name}${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
