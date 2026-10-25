// Cron, spoken. The file stores cron — an open format has no private
// schedule syntax — but people read "Every Monday at 08:00", so both the
// trigger editor and the schedule badges translate through this one module.
// A cron too clever for the presets renders as itself, which is honest.

export const SCHEDULE_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export const SCHEDULE_DAY_NAMES: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday",
  FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

export type SchedulePreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export function scheduleFromCron(cron: string): { preset: SchedulePreset; time: string; day: string } {
  const pad = (n: string) => n.padStart(2, "0");
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const [m, h, dom, mon, dow] = parts;
    const numeric = /^\d+$/.test(m) && /^\d+$/.test(h);
    if (numeric && dom === "*" && mon === "*" && (SCHEDULE_DAYS as readonly string[]).includes(dow)) {
      return { preset: "weekly", time: `${pad(h)}:${pad(m)}`, day: dow };
    }
    if (numeric && dom === "*" && mon === "*" && dow === "*") {
      return { preset: "daily", time: `${pad(h)}:${pad(m)}`, day: "MON" };
    }
    if (/^\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") {
      return { preset: "hourly", time: `08:${pad(m)}`, day: "MON" };
    }
    if (numeric && dom === "1" && mon === "*" && dow === "*") {
      return { preset: "monthly", time: `${pad(h)}:${pad(m)}`, day: "MON" };
    }
  }
  if (cron.trim() === "@hourly") return { preset: "hourly", time: "08:00", day: "MON" };
  if (cron.trim() === "@daily" || cron.trim() === "@midnight") return { preset: "daily", time: "00:00", day: "MON" };
  if (cron.trim() === "@weekly") return { preset: "weekly", time: "00:00", day: "SUN" };
  if (cron.trim() === "@monthly") return { preset: "monthly", time: "00:00", day: "MON" };
  return { preset: "custom", time: "08:00", day: "MON" };
}

/** "0 8 * * MON" → "Every Monday at 08:00" — or null when the cron is a
 *  shape the presets can't say, in which case show it raw. */
export function humanSchedule(cron: string): string | null {
  const { preset, time, day } = scheduleFromCron(cron);
  const minute = time.split(":")[1] ?? "00";
  switch (preset) {
    case "hourly": return `Every hour at :${minute}`;
    case "daily": return `Every day at ${time}`;
    case "weekly": return `Every ${SCHEDULE_DAY_NAMES[day]} at ${time}`;
    case "monthly": return `Monthly on the 1st at ${time}`;
    default: return null;
  }
}
