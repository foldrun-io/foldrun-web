// Inspect pages' small shared parts (UI refactor, Nov 2026): Observe,
// Checks, History, Issues and Inbox. Server-safe — plain links and class
// names, no state.
//
//   <Segmented>   a row of links that act as one control (a time range,
//                 a status filter), cloudhost's segmented switch
//   <ChartLegend> a swatch and its word, never colour alone
import * as React from "react";
import Link from "next/link";
import { cn } from "./cn";

export type Segment = { key: string; label: React.ReactNode; href: string; count?: number };

/** Links that read as one switch; the current one is filled. */
export function Segmented({ items, value, label, className }: { items: Segment[]; value: string; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-sunken p-0.5", className)}>
      {items.map((s) => {
        const on = s.key === value;
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-[13px] font-medium transition-colors",
              on ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {s.label}
            {s.count !== undefined && <span className={cn("tabular-nums", on ? "text-fg-muted" : "text-fg-subtle")}>{s.count}</span>}
          </Link>
        );
      })}
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
