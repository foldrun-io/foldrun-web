import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { requireCaller } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import fs from "node:fs";
import path from "node:path";
import { listWorkspaces, saveWorkspace, listAgents, listFlows, templateFiles, blankTemplateFiles, workspaceDir, type DeployFile } from "@/lib/store";
import { avatarUrl } from "@/platform/avatars";
import { demoWorkspaceFiles, DEMO_WORKSPACE } from "@/platform/demo-workspace";
import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { idempotent } from "@/server/idempotency";
import { settingText } from "@/platform/settings";

async function tenantOf(req: NextRequest) {
  return await requireTenant(req);
}

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
    // The plan's workspace count, checked only for NEW workspaces — pushing
    // to an existing one must never bounce off the limit, or a deploy to
    // workspace N becomes an outage the moment the plan shrinks.
    // The super admin's plan for this customer first, else the install-wide
    // default. A plan is a hosted concept: the `self-hosted` edition has no
    // workspace cap however FOLDRUN_PLAN_WORKSPACES is set, because there
    // is no plan.
    const cap = (await billing().plan(tenant))?.workspaces ?? Number(settingText("FOLDRUN_PLAN_WORKSPACES"));
    if (Number.isFinite(cap) && cap > 0 && platform.edition() === "hosted") {
      const existing = listWorkspaces(tenant);
      if (!existing.some((w) => w.name === body.name) && existing.length >= cap) {
        return NextResponse.json(
          { error: `this plan includes ${cap} workspace${cap === 1 ? "" : "s"} — delete one or upgrade` },
          { status: 402 },
        );
      }
    }
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
