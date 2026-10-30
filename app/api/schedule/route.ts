import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requireAccountWide } from "@/server/api";
import { listWorkspaces, listFlows } from "@/lib/store";
import { parseCron, cronMatches, tick } from "@/platform/scheduler";
import { scopeAllows } from "@/platform/scope";
import { idempotent } from "@/server/idempotency";

// Next N fire times for a cron, by scanning forward minute by minute.
function upcoming(expr: string, timeZone: string, count = 3): string[] {
  const cron = parseCron(expr);
  if (!cron) return [];
  const out: string[] = [];
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  for (let i = 1; i <= 60 * 24 * 40 && out.length < count; i++) {
    const t = new Date(start + i * 60_000);
    if (cronMatches(cron, t, timeZone)) out.push(t.toISOString());
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const scheduled = [];
    for (const workspace of listWorkspaces(tenant)) {
      // A member scoped to some workspaces sees those schedules, not the
      // account's: the flow names and cron lines of a workspace they
      // cannot open are not theirs to read.
      if (!scopeAllows(actor.workspaces, workspace.name)) continue;
      for (const flow of listFlows(tenant, workspace.name)) {
        if (flow.trigger !== "schedule" || !flow.schedule) continue;
        const tz = flow.timezone ?? "UTC";
        const valid = parseCron(flow.schedule) !== null;
        scheduled.push({
          workspace: workspace.name,
          /** @deprecated use `workspace` */
          project: workspace.name,
          flow: flow.name,
          schedule: flow.schedule,
          timezone: tz,
          steps: flow.steps.length,
          valid,
          upcoming: valid ? upcoming(flow.schedule, tz) : [],
        });
      }
    }
    return NextResponse.json({ scheduled });
  } catch (err) {
    return errorResponse(err);
  }
}

// Force a scheduler tick — for testing a schedule without waiting.
async function postOnce(req: NextRequest) {
  try {
    const { tenant } = await requireAccountWide(req, "workspace:manage");
    // The tick is the install's, and fires every tenant's due flows (they
    // were due anyway; this only makes them go now). The answer is the
    // caller's own: it listed every account's workspaces and flows.
    const due = await tick();
    return NextResponse.json({
      ok: true,
      fired: due.filter((d) => d.tenant === tenant).map((d) => `${d.workspace}/${d.flow.name}`),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
