"use client";

// The trigger picker on a flow card. Human-first: you say "every Monday at
// 08:00", it writes `0 8 * * MON` — cron stays what lands in the file (an
// open format has no private schedule syntax), but nobody has to speak it.
// Custom cron remains one preset away for the shapes the presets can't say.

import { useEffect, useState } from "react";
import { useResolvedTimeZone, useViewerTime } from "@/components/viewer-time";
import { useRouter } from "next/navigation";

import { inputClass, selectClass, buttonClass, chipButtonClass, FIELD_LABEL_CLASS } from "@/components/ui";
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
    case "hourly": return `Runs every hour at :${timeParts(time).m.padStart(2, "0")} (${zone})`;
    case "daily": return `Runs every day at ${time} (${zone})`;
    case "weekly": return `Runs every ${DAY_NAMES[day]} at ${time} (${zone})`;
    case "monthly": return `Runs on the 1st of every month at ${time} (${zone})`;
    default: return custom.trim() ? `Runs on cron “${custom.trim()}” (${zone})` : "";
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
  const initial = fromCron(schedule ?? "0 8 * * MON");
  const [open, setOpenState] = useState(startOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v) onClose?.();
  };
  const [kind, setKind] = useState(trigger);
  const [preset, setPreset] = useState<Preset>(schedule ? initial.preset : "weekly");
  const [time, setTime] = useState(initial.time);
  const [day, setDay] = useState<string>(initial.day);
  const [custom, setCustom] = useState(schedule ?? "0 8 * * MON");
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
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "could not save");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={chipButtonClass()}
      >
        Trigger…
      </button>
    );
  }

  // w-full drops the open panel onto its own row of the badge flex line —
  // an expanded editor inside a badge row was the layout bug this replaced.
  return (
    <div className="w-full rounded-md border border-line bg-sunken p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className={FIELD_LABEL_CLASS}>Starts</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass()}>
            <option value="manual">manually — Run button, CLI, API</option>
            <option value="schedule">on a schedule</option>
            <option value="webhook">when a URL is POSTed</option>
          </select>
        </label>

        {kind === "schedule" && (
          <>
            <label>
              <span className={FIELD_LABEL_CLASS}>How often</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
                className={selectClass()}
              >
                <option value="hourly">Every hour</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month (the 1st)</option>
                <option value="custom">Custom (cron)</option>
              </select>
            </label>
            {preset === "weekly" && (
              <label>
                <span className={FIELD_LABEL_CLASS}>On</span>
                <select value={day} onChange={(e) => setDay(e.target.value)} className={selectClass()}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {preset !== "custom" && (
              <label>
                <span className={FIELD_LABEL_CLASS}>{preset === "hourly" ? "At minute" : "At"}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClass("w-28")}
                />
              </label>
            )}
            {preset === "custom" && (
              <label>
                <span className={FIELD_LABEL_CLASS}>Cron expression</span>
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="0 8 * * MON"
                  className={inputClass("w-36 font-mono")}
                  title="minute hour day-of-month month day-of-week, or @daily / @hourly / @weekly"
                />
              </label>
            )}
            <label>
              <span className={FIELD_LABEL_CLASS}>Timezone</span>
              <input
                value={tz}
                onChange={(e) => { setTouched(true); setTz(e.target.value); }}
                placeholder="UTC"
                list="foldrun-timezones"
                className={inputClass("w-44")}
                title="IANA timezone, e.g. Australia/Sydney"
              />
              <datalist id="foldrun-timezones">
                {allZones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
          </>
        )}
        {kind === "webhook" && (
          <span className="pb-2 text-xs text-fg-muted">The URL appears under Settings → Triggers.</span>
        )}

        <button onClick={save} disabled={busy} className={buttonClass("primary")}>
          Save
        </button>
        <button onClick={() => setOpen(false)} className={buttonClass("minimal")}>
          Cancel
        </button>
      </div>

      {kind === "schedule" && (
        <p className="mt-2 text-xs text-fg-muted">{describe(preset, time, day, custom, tz)}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
