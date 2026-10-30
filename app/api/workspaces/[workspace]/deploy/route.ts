// Deploy a workspace over HTTP, with an API key.
//
// The third way files get in, beside the dashboard editor and a git push, and
// the one a laptop or a CI job uses: `foldrun deploy --url`. It exists because
// writing files one at a time through /files is not a deploy — nothing checks
// the result as a whole, and a loop that stops halfway leaves a broken
// workspace live.
//
// Same gate as every other path: the workspace is validated before any of it
// is live, and the swap is refused while a run is still reading the files.

import { NextRequest, NextResponse } from "next/server";
import { evaluateDeployed } from "@/lib/evals";
import { errorResponse, requirePermission } from "@/server/api";
import { audit } from "@/server/audit";
import { deployWorkspace, planDeploy } from "@/lib/deploy";
import { workspaceDir, type DeployFile } from "@/lib/store";
import { workspaceCapRefusal } from "@/server/workspace-cap";
import fs from "node:fs";
import { idempotent } from "@/server/idempotency";

/** A deploy is markdown, so this is generous — and still finite. */
const MAX_BYTES = 10 * 1024 * 1024;

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string }> },
) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:write");

    const body = (await req.json().catch(() => null)) as {
      files?: unknown;
      commit?: unknown;
      force?: unknown;
      dryRun?: unknown;
      expectRemoved?: unknown;
    } | null;

    if (!body || !Array.isArray(body.files)) {
      return NextResponse.json(
        { error: "expected { files: [{ path, content }] }" },
        { status: 400 },
      );
    }

    const files: DeployFile[] = [];
    let bytes = 0;
    for (const entry of body.files) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as DeployFile).path !== "string" ||
        typeof (entry as DeployFile).content !== "string"
      ) {
        return NextResponse.json(
          { error: "every file needs a string path and string content" },
          { status: 400 },
        );
      }
      const f = entry as DeployFile;
      bytes += f.content.length;
      if (bytes > MAX_BYTES) {
        return NextResponse.json({ error: "deploy is too large" }, { status: 413 });
      }
      files.push({ path: f.path, content: f.content });
    }

    const commit = typeof body.commit === "string" ? body.commit : null;

    // The removals the caller confirmed from a dry run. A run can write new
    // storage/ outputs between that dry run and this deploy; a yes to one
    // list is not a yes to a longer one, so a deploy that would now remove
    // anything outside it is refused (409) with the list it would remove.
    let expectRemoved: string[] | undefined;
    if (body.expectRemoved !== undefined) {
      if (!Array.isArray(body.expectRemoved) || !body.expectRemoved.every((p) => typeof p === "string")) {
        return NextResponse.json({ error: "expectRemoved must be an array of paths" }, { status: 400 });
      }
      expectRemoved = body.expectRemoved as string[];
    }

    // A dry run answers the same question without touching anything — the
    // shape a CI check wants before it decides whether to merge.
    if (body.dryRun === true) {
      const plan = planDeploy(tenant, workspace, files);
      return NextResponse.json({ ok: plan.issues.length === 0, applied: false, ...plan, files: undefined });
    }

    // A deploy to a name that does not exist yet MAKES a workspace, so it
    // needs what making one needs everywhere else (30 Oct 2026): the
    // workspace:manage role and room under the plan's workspace count, as
    // POST /api/workspaces and import ask. With workspace:write alone an
    // editor could make any number. `foldrun deploy` of a new workspace by
    // an admin is unchanged; a dry run writes nothing and is not asked.
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      await requirePermission(req, "workspace:manage");
      const overCap = await workspaceCapRefusal(tenant, workspace);
      if (overCap) return NextResponse.json({ error: overCap }, { status: 402 });
    }

    const result = deployWorkspace(tenant, workspace, files, {
      commit,
      force: body.force === true,
      expectRemoved,
    });
    // Every deploy is evaluated, and the score is stamped with the commit
    // when there is one and the saved revision otherwise — so Observe can say
    // which change moved it. A plain `foldrun deploy` sends no commit, and
    // gating on it here meant CLI deploys were never evaluated at all. Fired,
    // not awaited: a deploy answers in milliseconds and an eval takes minutes
    // and money.
    if (result.applied) {
      await audit("workspace.deployed", {
        actor: actor.name,
        tenant,
        subject: workspace,
        detail: { workspace, commit: result.commit ?? null, added: result.added.length, updated: result.updated.length, removed: result.removed.length },
      });
      void evaluateDeployed(tenant, workspace, result.commit).catch(() => {});
    }

    if (!result.applied && result.unexpectedRemovals?.length) {
      return NextResponse.json(
        {
          ok: false,
          reason: "removals changed",
          error: `this deploy would now also remove ${result.unexpectedRemovals.length} file(s) that were not confirmed`,
          removed: result.removed,
          unexpectedRemovals: result.unexpectedRemovals,
        },
        { status: 409 },
      );
    }

    if (!result.applied) {
      // 422: understood and refused, which is different from malformed. The
      // body says which, because the caller is a script that has to decide
      // between "fix your markdown" and "try again in a minute".
      return NextResponse.json(
        {
          ok: false,
          reason: result.issues.length ? "did not check out" : "runs in flight",
          issues: result.issues,
          warnings: result.warnings,
          blockedBy: result.blockedBy,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      applied: true,
      commit: result.commit,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      preserved: result.preserved,
      warnings: result.warnings,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
