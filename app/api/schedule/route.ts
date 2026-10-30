import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requireAccountWide } from "@/server/api";
import { listWorkspaces, listFlows } from "@/lib/store";
import { parseCron, cronCanFire, nextFire, tick } from "@/platform/scheduler";
import { scopeAllows } from "@/platform/scope";
import { idempotent } from "@/server/idempotency";

/** How far ahead the next fires are looked for. */
const LOOKAHEAD_DAYS = 40;

/**
 * Next N fire times for a cron, with the scheduler's own nextFire (30 Oct
 * 2026). This scanned forward a minute at a time — up to 57,600
 * cronMatches per flow per request, every one of them for a cron whose day
 * never comes (`0 0 30 2 *`). nextFire walks hours and skips the ones that
 * cannot match, and answers an impossible cron from its fields at once.
 */
function upcoming(expr: string, timeZone: string, count = 3, now = new Date()): string[] {
  const cron = parseCron(expr);
  if (!cron || !cronCanFire(cron)) return [];
  const out: string[] = [];
  const end = now.getTime() + LOOKAHEAD_DAYS * 86_400_000;
  let from = now;
  while (out.length < count) {
    const days = Math.ceil((end - from.getTime()) / 86_400_000);
    if (days <= 0) break;
    const at = nextFire(cron, from, timeZone, days);
    if (!at || at.getTime() > end) break;
    out.push(at.toISOString());
    from = at;
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
    // This account's pass only (30 Oct 2026): its due flows go now (they
    // were due anyway). It ran the install's whole tick — every account's
    // flows, watches and chores — on any admin's press.
    const due = await tick(new Date(), { tenant });
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
