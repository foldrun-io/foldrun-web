// Scheduled fires that started no run (FOL-72 step 7): "due 09:00, no run".
// Derived, like the issues they become: walk each scheduled flow's fires over
// the last week, from no earlier than its file last changed, and keep the
// ones no run of the flow covers — none started from two minutes before to
// thirty after, and none was already going (overlap: skip is meant). The
// scheduler's own nextFire and the flow's zone, as the scheduler reads them.

import fs from "node:fs";
import path from "node:path";
import { listFlows, workspaceDir } from "@/lib/store";
import type { IssueRun } from "@/lib/issues";
import { parseCron, nextFire } from "@/platform/scheduler";
import type { RunLite } from "@/components/mission-model";

const WEEK = 7 * 86_400_000;
/** How late a fire may start and still be on time (a busy queue). */
const LATE = 30 * 60_000;
const EARLY = 2 * 60_000;

/** `paused`: the windows a workspace was paused by its people (admin.ts
 *  pauseWindows) — a fire inside one was refused on purpose, not missed. */
export function missedFires(
  tenant: string,
  workspaces: string[],
  runs: RunLite[],
  now = Date.now(),
  paused: (workspace: string) => { from: number; to: number | null }[] = () => [],
): IssueRun[] {
  const out: IssueRun[] = [];
  for (const ws of workspaces) {
    let flows;
    try {
      flows = listFlows(tenant, ws);
    } catch {
      continue;
    }
    for (const f of flows) {
      if (f.trigger !== "schedule" || !f.schedule) continue;
      const cron = parseCron(f.schedule);
      if (!cron) continue;
      let changed = 0;
      try {
        changed = fs.statSync(path.join(workspaceDir(tenant, ws), "flows", f.file)).mtimeMs;
      } catch {
        continue;
      }
      const tz = f.timezone ?? "UTC";
      const mine = runs.filter((r) => r.workspace === ws && r.what === f.name);
      const held = paused(ws);
      let at = nextFire(cron, new Date(Math.max(now - WEEK, changed)), tz, 8);
      for (let n = 0; at && at.getTime() <= now - LATE && n < 500; n++) {
        const t = at.getTime();
        const covered = mine.some((r) => {
          const s = Date.parse(r.startedAt);
          const e = r.finishedAt ? Date.parse(r.finishedAt) : now;
          return (s >= t - EARLY && s <= t + LATE) || (s < t && e > t);
        });
        const halted = held.some((w) => t >= w.from && (w.to === null || t <= w.to));
        if (!covered && !halted) {
          const local = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
          out.push({ workspace: ws, id: `missed-${at.toISOString()}`, what: f.name, outcome: "failed", startedAt: at.toISOString(), missed: true, headline: `due ${local} (${tz}), no run started` });
        }
        at = nextFire(cron, at, tz, 8);
      }
    }
  }
  return out;
}
