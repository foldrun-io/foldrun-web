// The kill switch, shared by the account's and a workspace's routes: pause
// (no new run starts — schedules, webhooks, chained flows, a person's Run),
// optionally stopping the runs already going, and resume. The state is the
// platform's (admin.ts `paused`), not a file: a deploy must never un-pause.

import { NextResponse } from "next/server";
import { adminState, setPaused, pauseOf, workspacePause, type PauseMark } from "@/platform/admin";
import { stopRun } from "@/platform/queue";
import { listRuns, listWorkspaces } from "@/lib/store";
import { can } from "@/platform/permissions";
import { scopeAllows } from "@/platform/scope";
import { audit } from "@/server/audit";
import { ApiError } from "@/server/api";
import type { Actor } from "@/server/auth";

const live = (m: PauseMark | undefined) => (m && !m.resumedAt ? m : null);

/** What holds runs: the account's own pause, a workspace's own, and the one
 *  that applies (the account's when both). */
export async function pauseView(tenant: string, workspace: string | null, scope: string[] | null = null) {
  const state = await adminState(tenant);
  return {
    paused: pauseOf(state, workspace),
    account: live(state.paused?.account),
    ...(workspace ? { workspace: live(workspacePause(state, workspace)) } : {}),
    ...(workspace
      ? {}
      : {
          workspaces: Object.fromEntries(
            // A caller scoped to some workspaces is not told about the
            // others — not their names, who paused them, or why.
            Object.entries(state.paused?.workspaces ?? {}).filter(([ws, m]) => !m.resumedAt && scopeAllows(scope, ws)),
          ) as Record<string, PauseMark>,
        }),
  };
}

/** Pause, and with `stop` stop every running or queued run it covers. */
export async function pause(tenant: string, actor: Actor, workspace: string | null, body: { reason?: unknown; stop?: unknown }) {
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const stop = body.stop === true;
  if (stop && !can(actor.role, "run:start")) throw new ApiError(`your role (${actor.role}) cannot stop runs`, 403);
  await setPaused(tenant, workspace, { pause: { by: actor.name, ...(reason ? { reason } : {}) } });
  const stopped: string[] = [];
  const failed: { runId: string; workspace: string; error: string }[] = [];
  if (stop) {
    const where = workspace ? [workspace] : listWorkspaces(tenant).map((w) => w.name).filter((w) => scopeAllows(actor.workspaces, w));
    for (const ws of where) {
      // Parked runs too — on an approval or a `wait: event` — or a resume
      // would pick them up again after the pause promised they were stopped.
      for (const run of listRuns(tenant, ws).filter((r) => r.status === "running" || r.status === "queued" || r.status === "awaiting-approval")) {
        // Each run its own outcome, like a bulk stop: one that finished a
        // second ago must not leave the other thirty going.
        try {
          stopRun(tenant, ws, run.id);
          stopped.push(`${ws}/${run.id}`);
        } catch (err) {
          failed.push({ runId: run.id, workspace: ws, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }
  await audit(workspace ? "workspace.paused" : "account.paused", {
    actor: actor.name,
    tenant,
    ...(workspace ? { subject: workspace } : {}),
    detail: { ...(reason ? { reason } : {}), stop, stopped: stopped.length },
  });
  return NextResponse.json({ ok: true, ...(await pauseView(tenant, workspace, actor.workspaces)), stopped, failed });
}

export async function resume(tenant: string, actor: Actor, workspace: string | null) {
  await setPaused(tenant, workspace, { resume: { by: actor.name } });
  await audit(workspace ? "workspace.resumed" : "account.resumed", { actor: actor.name, tenant, ...(workspace ? { subject: workspace } : {}) });
  return NextResponse.json({ ok: true, ...(await pauseView(tenant, workspace, actor.workspaces)) });
}
