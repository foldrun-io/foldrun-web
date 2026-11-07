// Chart atoms, drawn without a chart library: a strip of bars (Sparkbars),
// a fraction against its cap (Meter), and a chart's key (ChartLegend: a
// swatch and its word, never colour alone). Server-safe.
import * as React from "react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export interface Bar {
  key: string;
  value: number;
  /** A second series drawn beside the first: paid beside charged. */
  second?: number;
  title?: string;
}

/** A strip of bars scaled to the tallest. The shape of a number over time,
 *  in the width of a card, without a chart library. */
export function Sparkbars({
  bars,
  height = 40,
  className = "",
  max: scale,
}: {
  bars: Bar[];
  height?: number;
  className?: string;
  /** Scale against this instead of the strip's own tallest bar — so rows
   *  of a table compare with each other, not each with itself. */
  max?: number;
}) {
  const max = Math.max(0.000001, scale ?? 0, ...bars.flatMap((b) => [b.value, b.second ?? 0]));
  return (
    <div className={cn("flex items-end gap-[3px]", className)} style={{ height }}>
      {bars.map((b) => (
        <Tooltip key={b.key} label={b.title}>
        <div className="flex flex-1 items-end gap-px">
          <span className="w-full rounded-sm bg-fg/80" style={{ height: `${Math.max(1, (b.value / max) * height)}px` }} />
          {b.second !== undefined && (
            <span className="w-full rounded-sm bg-success" style={{ height: `${Math.max(1, (b.second / max) * height)}px` }} />
          )}
        </div>
        </Tooltip>
      ))}
    </div>
  );
}

/** A fraction as a bar with marks — a budget against its cap, with the
 *  warning thresholds drawn where they fire. */
export function Meter({ fraction, marks = [], tone }: { fraction: number; marks?: number[]; tone?: "warn" | "error" }) {
  const pct = Math.min(100, Math.max(0, fraction * 100));
  const fill = tone === "error" ? "bg-danger" : tone === "warn" ? "bg-warning" : "bg-fg";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      {marks.map((m) => (
        <span key={m} className="absolute inset-y-0 w-px bg-surface/80" style={{ left: `${m}%` }} />
      ))}
    </div>
  );
}

/** A chart's key: each series' swatch beside its name. */
export function ChartLegend({ items, aside, className }: { items: { key: string; label: React.ReactNode; swatch: string }[]; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted", className)}>
      {items.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", s.swatch)} aria-hidden />
          {s.label}
        </span>
      ))}
      {aside && <span className="ml-auto text-fg-subtle">{aside}</span>}
    </div>
  );
}
