"use client";

// Which clock you read the dashboard in.
//
// Automatic is the default and stays the default: your browser already knows
// your zone, and asking you to retype it would be a form that can only be
// wrong. The override exists for the cases detection genuinely cannot serve —
// running a business in another region, working while travelling, or a team
// agreeing that "the 8am run" means one specific hour.
//
// This does NOT change when anything runs. A flow's `timezone:` decides that,
// and it is a property of the schedule, not of whoever is looking at it.

import { useState } from "react";
import { buttonClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { useDetectedTimeZone, useViewerTime } from "@/components/viewer-time";

const AUTOMATIC = "";

/** Every zone this browser knows, so the list cannot go stale against IANA. */
function zones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  try {
    return supported ? supported("timeZone") : [];
  } catch {
    return [];
  }
}

export function TimezoneForm({ current }: { current: string | null }) {
  const detected = useDetectedTimeZone();
  const [value, setValue] = useState(current ?? AUTOMATIC);
  const [saved, setSaved] = useState<string | null>(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const all = zones();

  // Previewed through the same hook every timestamp uses, so what you see
  // here is literally what the rest of the dashboard will show.
  const preview = useViewerTime(new Date().toISOString(), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const dirty = (saved ?? AUTOMATIC) !== value;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        const res = await fetch("/api/auth/timezone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ timezone: value === AUTOMATIC ? null : value }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (!res.ok) return setError(body.error ?? "could not save your timezone");
        setSaved(value === AUTOMATIC ? null : value);
        // The provider is read at the layout, so the new clock applies once
        // the server re-renders. Reloading is the honest way to show that
        // rather than holding a second copy of the preference in the page.
        window.location.reload();
      }}
    >
      <div>
        <label className={FIELD_LABEL_CLASS} htmlFor="tz">
          Timezone
        </label>
        <select
          id="tz"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
        >
          <option value={AUTOMATIC}>
            Automatic{detected ? ` — ${detected}` : ""}
          </option>
          {all.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-fg-muted">
        {saved
          ? `Times are shown in ${saved}.`
          : "Times are shown in whatever zone your device reports."}
        {preview ? ` Right now that reads ${preview}.` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-faint pt-3">
        <button type="submit" className={buttonClass()} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save timezone"}
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : !dirty && <span className="text-xs text-fg-subtle">Nothing to save.</span>}
      </div>
    </form>
  );
}
