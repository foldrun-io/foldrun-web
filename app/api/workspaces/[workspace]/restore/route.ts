// Restore a workspace's source to a point in its history.
//
//   POST { to, dryRun: true }                  what would change, with diffs
//   POST { to, confirm: "<workspace>", expectRemoved? }   do it
//
// `to` is a commit (or a prefix of one), a branch or tag, an ISO date or
// time ("the last commit at or before it"), or an age: 3d, 12h, 2w.
//
// The restore is a deploy of that point's tree as a new commit on main, so
// it is undone the same way: restore to the `from` it answers with. It never
// touches runs, state/, storage/ or secrets — see server/restore.ts. A
// restore without `confirm` set to the workspace's name is refused: the
// dry run is the question, the name typed back is the answer.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, actorOf, errorResponse, ApiError } from "@/server/api";
import { applyRestore, planRestore } from "@/server/restore";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

/** At most once per Idempotency-Key — server/idempotency.ts. A dry run is
 *  safe to repeat; a restore answered twice would be one restore anyway, but
 *  the second answer would say "nothing to do" instead of what was done. */
export async function POST(req: NextRequest, ctx: Ctx) {
  return idempotent(req, () => restorePost(req, ctx));
}

async function restorePost(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    const body = (await req.json().catch(() => ({}))) as { to?: unknown; dryRun?: unknown; confirm?: unknown; expectRemoved?: unknown };
    if (typeof body.to !== "string" || !body.to.trim()) throw new ApiError("expected { to: <commit, date or age> }", 400);
    const to = body.to.trim();

    if (body.dryRun === true) return NextResponse.json({ dryRun: true, ...planRestore(tenant, workspace, to) });

    if (body.confirm !== workspace) {
      throw new ApiError(`a restore needs { confirm: "${workspace}" } — run it with { dryRun: true } first to see what changes`, 400);
    }
    const expectRemoved = Array.isArray(body.expectRemoved) ? body.expectRemoved.filter((p): p is string => typeof p === "string") : undefined;
    const by = await actorOf(req);
    const result = applyRestore(tenant, workspace, to, { by, expectRemoved, actor });
    const { plan } = result;
    if (plan.noop) return NextResponse.json({ ok: true, applied: false, noop: true, to: plan.to, main: result.main });
    if (!result.applied) {
      const why = result.unexpectedRemovals
        ? `it would now also remove ${result.unexpectedRemovals.join(", ")} — run the dry run again`
        : plan.blockedBy.length
          ? `runs are in flight (${plan.blockedBy.join(", ")}) — try again when they finish`
          : "the restored files do not pass the deploy checks";
      return NextResponse.json(
        { ok: false, applied: false, error: `not restored: ${why}`, blockedBy: plan.blockedBy, unexpectedRemovals: result.unexpectedRemovals, issues: result.issues },
        { status: 409 },
      );
    }
    await audit("workspace.restored", {
      actor: by,
      tenant,
      subject: workspace,
      detail: { workspace, to: plan.to.sha, requested: to, from: plan.from, added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length },
    });
    return NextResponse.json({
      ok: true,
      applied: true,
      to: plan.to,
      from: plan.from,
      main: result.main,
      added: plan.added,
      updated: plan.updated,
      removed: plan.removed,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
