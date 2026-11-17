"use client";

// The trigger picker on a flow card. Human-first: you say "every Monday at
// 08:00", it writes `0 8 * * MON` — cron stays what lands in the file (an
// open format has no private schedule syntax), but nobody has to speak it.
// Custom cron remains one preset away for the shapes the presets can't say.

import { $t } from "@/i18n";
import { useEffect, useState } from "react";
import { useResolvedTimeZone } from "@/components/viewer-time";
import { useRouter } from "next/navigation";

import { Input, labelClass } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Zap } from "lucide-react";
import { Combobox } from "@foldrun/ui/react/combobox";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { TimeField } from "@foldrun/ui/react/time-field";
import {
  SCHEDULE_DAYS as DAYS,
  SCHEDULE_DAY_NAMES as DAY_NAMES,
  scheduleFromCron as fromCron,
  type SchedulePreset as Preset,
} from "@/components/schedule-human";

/** "HH:MM" → cron's minute/hour pair. */
const timeParts = (t: string) => {
  const [h = "8", m = "0"] = t.split(":");
  return { h: String(Number(h)), m: String(Number(m)) };
};

function toCron(preset: Preset, time: string, day: string, custom: string): string {
  const { h, m } = timeParts(time);
  switch (preset) {
    case "hourly": return `${m} * * * *`;
    case "daily": return `${m} ${h} * * *`;
    case "weekly": return `${m} ${h} * * ${day}`;
    case "monthly": return `${m} ${h} 1 * *`;
    default: return custom;
  }
}

function describe(preset: Preset, time: string, day: string, custom: string, tz: string): string {
  const zone = tz.trim() || "UTC";
  switch (preset) {
    case "hourly": return $t("workspace.flows-trigger-editor.runsEveryHourAt", { v0: String(timeParts(time).m.padStart(2, "0")), zone: String(zone) });
    case "daily": return $t("workspace.flows-trigger-editor.runsEveryDayAt", { time: String(time), zone: String(zone) });
    case "weekly": return $t("workspace.flows-trigger-editor.runsEveryAt", { v0: String(DAY_NAMES[day]), time: String(time), zone: String(zone) });
    case "monthly": return $t("workspace.flows-trigger-editor.runsOnThe1stOfEvery", { time: String(time), zone: String(zone) });
    default: return custom.trim() ? $t("workspace.flows-trigger-editor.runsOnCron", { v0: String(custom.trim()), zone: String(zone) }) : "";
  }
}

/** Every zone this browser knows — a hardcoded six went stale the moment
 *  someone scheduled work outside them. */
function ianaZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  try {
    return supported ? supported("timeZone") : ["UTC"];
  } catch {
    return ["UTC"];
  }
}

export function TriggerEditor({
  workspace,
  flow,
  trigger,
  schedule,
  timezone,
  startOpen = false,
  onClose,
}: {
  workspace: string;
  flow: string;
  trigger: string;
  schedule?: string | null;
  timezone?: string | null;
  /** Open on mount — the canvas opens it from its trigger node. */
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const initial = fromCron(schedule ?? $t("workspace.flows-trigger-editor.08Mon"));
  const [open, setOpenState] = useState(startOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v) onClose?.();
  };
  const [kind, setKind] = useState(trigger);
  const [preset, setPreset] = useState<Preset>(schedule ? initial.preset : "weekly");
  const [time, setTime] = useState(initial.time);
  const [day, setDay] = useState<string>(initial.day);
  const [custom, setCustom] = useState(schedule ?? $t("workspace.flows-trigger-editor.08Mon"));
  // A schedule needs a real zone written into the file. Default it to the
  // person's own — that is the answer they mean nine times out of ten, and
  // leaving it blank silently meant UTC, which is nobody's working day.
  // It stays an editable field, because the right answer is sometimes the
  // AUDIENCE's zone rather than the author's.
  const myZone = useResolvedTimeZone();
  const allZones = ianaZones();
  const [tz, setTz] = useState(timezone ?? "");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && !timezone && myZone) setTz(myZone);
  }, [myZone, timezone, touched]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspace}/flows/${flow}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trigger: {
          trigger: kind,
          schedule: toCron(preset, time, day, custom),
          timezone: tz || undefined,
        },
      }),
    });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? $t("workspace.flows-trigger-editor.couldNotSave"));
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: "secondary" })}
      >
        <Zap aria-hidden />
        {$t("workspace.flows-trigger-editor.changeTrigger")}
      </button>
    );
  }

  // w-full drops the open panel onto its own row of the badge flex line —
  // an expanded editor inside a badge row was the layout bug this replaced.
  return (
    <div className="w-full rounded-lg border border-line bg-sunken p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className={labelClass}>{$t("workspace.flows-trigger-editor.starts")}</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} >
            <option value="manual">{$t("workspace.flows-trigger-editor.manuallyRunButtonCliApi")}</option>
            <option value="schedule">{$t("workspace.flows-trigger-editor.onASchedule")}</option>
            <option value="webhook">{$t("workspace.flows-trigger-editor.whenAUrlIsPosted")}</option>
          </Select>
        </label>

        {kind === "schedule" && (
          <>
            <label>
              <span className={labelClass}>{$t("workspace.flows-trigger-editor.howOften")}</span>
              <Select
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
              >
                <option value="hourly">{$t("workspace.flows-trigger-editor.everyHour")}</option>
                <option value="daily">{$t("workspace.flows-trigger-editor.everyDay")}</option>
                <option value="weekly">{$t("workspace.flows-trigger-editor.everyWeek")}</option>
                <option value="monthly">{$t("workspace.flows-trigger-editor.everyMonthThe1st")}</option>
                <option value="custom">{$t("workspace.flows-trigger-editor.customCron")}</option>
              </Select>
            </label>
            {preset === "weekly" && (
              <label>
                <span className={labelClass}>{$t("workspace.flows-trigger-editor.on")}</span>
                <Select value={day} onChange={(e) => setDay(e.target.value)} >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {preset !== "custom" && (
              <div>
                <span className={labelClass}>{preset === "hourly" ? $t("workspace.flows-trigger-editor.atMinute") : $t("workspace.flows-trigger-editor.at")}</span>
                <TimeField label={preset === "hourly" ? $t("workspace.flows-trigger-editor.atMinute") : $t("workspace.flows-trigger-editor.at")} value={time} onChange={setTime} />
              </div>
            )}
            {preset === "custom" && (
              <label>
                <span className={labelClass}>{$t("workspace.flows-trigger-editor.cronExpression")}</span>
                <Tooltip label={$t("workspace.flows-trigger-editor.minuteHourDayOfMonthMonth")}>
                  <Input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder={$t("workspace.flows-trigger-editor.08Mon")}
                    className="w-36 font-mono"
                  />
                </Tooltip>
              </label>
            )}
            <label>
              <span className={labelClass}>{$t("workspace.flows-trigger-editor.timezone")}</span>
              <Tooltip label={$t("workspace.flows-trigger-editor.ianaTimezone")}>
                <Combobox
                  options={allZones}
                  value={tz}
                  onChange={(e) => { setTouched(true); setTz(e.target.value); }}
                  placeholder="UTC"
                  className="w-44"
                />
              </Tooltip>
            </label>
          </>
        )}
        {kind === "webhook" && (
          <span className="pb-2 text-xs text-fg-muted">{$t("workspace.flows-trigger-editor.theUrlAppearsUnderThisWorkspace")}</span>
        )}

        <button onClick={save} disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>
          {$t("workspace.flows-trigger-editor.save")}
        </button>
        <button onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>
          {$t("workspace.flows-trigger-editor.cancel")}
        </button>
      </div>

      {kind === "schedule" && (
        <p className="mt-2 text-xs text-fg-muted">{describe(preset, time, day, custom, tz)}</p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
