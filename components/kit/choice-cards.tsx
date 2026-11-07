"use client";

// One of a few options, as cards (cloudhost's ChoiceCards): a radio group
// whose options carry an icon, a title, a line and an optional badge. The
// welcome flow's "What do you want to start with?" uses it.

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export type Choice = { value: string; title: string; description?: string; icon?: ReactNode; badge?: ReactNode; disabled?: boolean };

export function ChoiceCards({ options, value, onChange, label, columns = 2 }: { options: Choice[]; value: string | null; onChange: (v: string) => void; label: string; columns?: 1 | 2 | 3 }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1.5 rounded-lg border bg-surface p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50",
              on ? "border-fg ring-1 ring-fg" : "border-line hover:border-line-strong hover:bg-sunken",
            )}
          >
            <span className="flex w-full items-center gap-2">
              {o.icon && <span className="flex shrink-0 text-fg-muted [&_svg]:size-4">{o.icon}</span>}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{o.title}</span>
              {o.badge && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-fg-muted">{o.badge}</span>}
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-ink bg-ink text-on-ink" : "border-line-strong")} aria-hidden>
                {on && <Check className="size-3" />}
              </span>
            </span>
            {o.description && <span className="text-sm text-fg-muted">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
