"use client";

// A time of day, "HH:MM", as two kit Selects — the kit's stand-in for
// <input type="time"> (owner rule: no browser controls in the UI). Typing a
// digit jumps through either list, as Select's typeahead does.
import { Select } from "./select";
import { cn } from "./cn";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function TimeField({
  value,
  onChange,
  className,
  label = "Time",
  disabled,
}: {
  /** "HH:MM"; empty reads as 00:00. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Names the two lists: "<label> hour", "<label> minute". */
  label?: string;
  disabled?: boolean;
}) {
  const [h = "00", m = "00"] = (value || "00:00").split(":");
  return (
    <span role="group" aria-label={label} className={cn("inline-flex items-center gap-1", className)}>
      <Select aria-label={`${label} hour`} value={pad(Number(h) || 0)} disabled={disabled} onValueChange={(v) => onChange(`${v}:${pad(Number(m) || 0)}`)} selectClassName="w-[4.25rem] tabular-nums">
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
      <span aria-hidden className="text-fg-muted">
        :
      </span>
      <Select aria-label={`${label} minute`} value={pad(Number(m) || 0)} disabled={disabled} onValueChange={(v) => onChange(`${pad(Number(h) || 0)}:${v}`)} selectClassName="w-[4.25rem] tabular-nums">
        {MINUTES.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
    </span>
  );
}
