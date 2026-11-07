"use client";

// Slider: a value along a range, on Radix — the kit's stand-in for
// <input type="range"> (owner rule: no browser controls in the UI). Arrow
// keys, Home and End move it; `tone="danger"` for a live, red context.
import { Slider as R } from "radix-ui";
import { cn } from "./cn";

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  tone = "default",
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  tone?: "default" | "danger";
  className?: string;
  "aria-label": string;
}) {
  return (
    <R.Root value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onValueChange(v)} className={cn("relative flex h-4 w-full touch-none select-none items-center", className)}>
      <R.Track className="relative h-1 grow overflow-hidden rounded-full bg-muted-strong">
        <R.Range className={cn("absolute h-full", tone === "danger" ? "bg-danger" : "bg-fg")} />
      </R.Track>
      <R.Thumb aria-label={ariaLabel} className={cn("block size-3.5 rounded-full border-2 bg-surface shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", tone === "danger" ? "border-danger" : "border-fg")} />
    </R.Root>
  );
}
