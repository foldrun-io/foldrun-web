// Segmented: a row of choices that read as one control — a time range, a
// status filter, a view switch, a theme. cloudhost's segmented switch, the
// only one: one sunken box, the chosen value raised in it. Server-safe (no
// state); the caller owns the value.
//
//   links    every item has an `href`: the URL is the state (filters, ranges)
//   buttons  `onChange`: the caller's state. `role` says what it is to a
//            screen reader: "group" (pressed buttons, the default),
//            "tablist" (it swaps what is shown below) or "radiogroup" (a
//            setting, like the theme)
import * as React from "react";
import Link from "next/link";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export type Segment = {
  key: string;
  label?: React.ReactNode;
  /** Link mode: where this choice goes. */
  href?: string;
  icon?: React.ReactNode;
  count?: number;
  /** Accessible name (for an icon-only choice) and its hover help. */
  title?: string;
};

const SIZE = {
  sm: { box: "h-8", item: "px-2 text-xs", square: "w-7", icon: "[&_svg]:size-3.5" },
  md: { box: "h-9", item: "px-3 text-[13px]", square: "w-9", icon: "[&_svg]:size-4" },
  lg: { box: "h-10", item: "px-3 text-[13px]", square: "w-9", icon: "[&_svg]:size-4" },
} as const;

export function Segmented({
  items,
  value,
  label,
  onChange,
  role = "group",
  size = "md",
  current = "page",
  disabled = false,
  className,
}: {
  items: Segment[];
  value: string;
  /** What the control chooses: its accessible name. */
  label: string;
  onChange?: (key: string) => void;
  role?: "group" | "tablist" | "radiogroup";
  size?: keyof typeof SIZE;
  /** Link mode: the aria-current the chosen link carries. */
  current?: "page" | "true";
  disabled?: boolean;
  className?: string;
}) {
  const sz = SIZE[size];
  // A handler made here, not an inline arrow: this file is server-safe, and
  // buttons mode is only ever drawn from a client component.
  const pick = (key: string) => () => onChange?.(key);
  return (
    <div role={role} aria-label={label} className={cn("inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-sunken p-0.5", sz.box, className)}>
      {items.map((s) => {
        const on = s.key === value;
        const cls = cn(
          "flex h-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 [&_svg]:shrink-0",
          sz.icon,
          s.label == null ? sz.square : sz.item,
          on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-fg-muted hover:text-fg",
        );
        const body = (
          <>
            {s.icon}
            {s.label}
            {s.count !== undefined && <span className={cn("tabular-nums", on ? "text-fg-muted" : "text-fg-subtle")}>{s.count}</span>}
          </>
        );
        if (s.href !== undefined && !onChange) {
          return (
            <Tooltip key={s.key} label={s.title}>
              <Link href={s.href} aria-current={on ? current : undefined} aria-label={s.label == null ? s.title : undefined} className={cls}>
                {body}
              </Link>
            </Tooltip>
          );
        }
        const state =
          role === "tablist" ? { role: "tab", "aria-selected": on } : role === "radiogroup" ? { role: "radio", "aria-checked": on } : { "aria-pressed": on };
        return (
          <Tooltip key={s.key} label={s.title}>
            <button type="button" {...state} disabled={disabled} aria-label={s.label == null ? s.title : undefined} onClick={pick(s.key)} className={cls}>
              {body}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
