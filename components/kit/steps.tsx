"use client";

// A multi-step flow's pieces (cloudhost's onboarding StepRail): the steps
// down the side — across the top on a phone, numbers only — each a link to
// its screen, and one screen's frame: a big title, one line, the body, and
// its actions under a hairline. Used by the welcome flow
// (components/welcome-flow.tsx); anything stepwise can take them.

import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export type RailStep = { key: string; label: string; state: "done" | "current" | "todo"; href: string };

export function StepRail({ steps, label }: { steps: RailStep[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] md:flex-col md:gap-0.5">
        {steps.map((s, i) => {
          const body = (
            <>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                  s.state === "done" && "border-ink bg-ink text-on-ink",
                  s.state === "current" && "border-fg text-fg",
                  s.state === "todo" && "border-line text-fg-muted",
                )}
              >
                {s.state === "done" ? <Check className="size-3.5" aria-label="done" /> : i + 1}
              </span>
              <span className={cn("min-w-0 truncate max-md:sr-only", s.state === "current" ? "font-medium text-fg" : "text-fg-muted")}>{s.label}</span>
            </>
          );
          const cls = cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", s.state === "current" && "md:bg-muted");
          return (
            <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className="shrink-0 md:shrink">
              {s.state === "current" ? (
                <div className={cls}>{body}</div>
              ) : (
                <Link href={s.href} replace scroll={false} className={cn(cls, "hover:bg-sunken")}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** One screen of a stepwise flow: "Step 2 of 4", the title, its line, the
 *  body, then the actions (Continue, Skip) under a hairline. */
export function StepPanel({ title, body, kicker, children, actions }: { title: string; body?: ReactNode; kicker?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {kicker && <p className="text-sm text-fg-muted">{kicker}</p>}
        <h2 className="text-2xl font-semibold tracking-tight text-fg">{title}</h2>
        {body && <p className="max-w-2xl text-fg-muted">{body}</p>}
      </div>
      {children}
      {actions && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5 empty:hidden">{actions}</div>}
    </div>
  );
}

/** The two columns a stepwise flow sits in: the rail, then the screen. */
export function StepLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="min-w-0">{rail}</aside>
      <section className="min-w-0 space-y-6">{children}</section>
    </div>
  );
}
