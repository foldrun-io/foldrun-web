"use client";

// A checklist card (cloudhost's ChecklistCard / Getting started): a title,
// how far along it is (a ring, or "3/5"), and rows that tick themselves —
// each a link to where the thing is done, struck through once it is. One
// row may be opened up (`detail`: the next step's why and its button). A
// row's "…" menu hides it, and the card's own menu takes whatever the page
// passes (hide the card, show hidden rows). Data in; the page decides what
// each row means and what hiding does.
//
// Used by the account home's Getting started (components/onboarding-card.tsx)
// and a workspace's checklist (components/workspace-checklist.tsx).

import Link from "@/components/kit/link";
import type { ReactNode } from "react";
import { Check, Circle, Ellipsis, EyeOff } from "lucide-react";
import { Button } from "./button";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "./menu";
import { RingProgress } from "./page";
import { cn } from "./cn";

export type ChecklistRow = {
  key: string;
  label: string;
  /** A quiet line under a row not yet done. */
  hint?: ReactNode;
  icon?: ReactNode;
  href: string;
  done: boolean;
  /** Opens the row up: drawn under its label instead of a link. */
  detail?: ReactNode;
  /** Shows the row's "…" menu with one item: hide it. */
  onHide?: () => void;
};

export function ChecklistCard({
  title,
  rows,
  progress = "count",
  actions,
  menu,
  menuLabel,
  hideLabel = "Hide",
  busy = false,
  footer,
  className,
}: {
  title: string;
  rows: ChecklistRow[];
  /** "ring": a ring and "n of m done"; "count": a small "n/m". Counted over
   *  every row given (hidden ones are the page's to leave out or keep). */
  progress?: "ring" | "count" | { done: number; total: number; style: "ring" | "count" };
  /** Beside the title, before the menu (Resume setup). */
  actions?: ReactNode;
  /** The card's "…" menu: MenuItems. */
  menu?: ReactNode;
  menuLabel?: string;
  /** The row menu's one item ("Hide this step"). */
  hideLabel?: string;
  busy?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const p = typeof progress === "object" ? progress : { done: rows.filter((r) => r.done).length, total: rows.length, style: progress };
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-lg border border-line bg-surface", className)} aria-label={title}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 pb-2 pt-3">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {p.style === "ring" ? (
          <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
            {/* The kit's ring warns as it fills (it is made for usage);
                progress is good news, so it stays one colour. */}
            <span className="flex [&>svg]:!text-success">
              <RingProgress value={p.done / Math.max(1, p.total)} size={18} label={`${p.done} of ${p.total} done`} />
            </span>
            <span className="tabular-nums">
              {p.done} of {p.total}
            </span>
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-fg-muted">
            {p.done}/{p.total}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {menu && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-fg-muted" aria-label={menuLabel ?? `${title} options`} disabled={busy}>
                  <Ellipsis aria-hidden />
                </Button>
              </MenuTrigger>
              <MenuContent>{menu}</MenuContent>
            </Menu>
          )}
        </div>
      </div>
      <ul className="space-y-1.5 px-3 pb-3">
        {rows.map((r) => (
          <li key={r.key} className="relative">
            {r.detail && !r.done ? (
              <div className="space-y-3 rounded-md border border-line-strong bg-sunken px-3 py-3 text-sm [&>div>svg]:size-4 [&>div>svg]:shrink-0">
                <div className="flex min-w-0 items-start gap-2.5 pr-7">
                  <span className="mt-0.5 flex shrink-0 text-fg [&_svg]:size-4">{r.icon ?? <Circle />}</span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium text-fg">{r.label}</p>
                    {r.hint && <p className="text-fg-muted">{r.hint}</p>}
                  </div>
                </div>
                <div className="pl-6.5">{r.detail}</div>
              </div>
            ) : (
              <Link
                href={r.href}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  r.done ? "text-fg-muted hover:bg-sunken hover:text-fg-secondary" : "bg-sunken text-fg hover:bg-muted",
                  r.onHide && !r.done && "pr-11",
                )}
              >
                {r.icon && <span className="flex shrink-0 [&_svg]:size-4">{r.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", r.done && "line-through decoration-fg-subtle decoration-1")}>{r.label}</span>
                  {!r.done && r.hint && <span className="block truncate text-xs text-fg-muted">{r.hint}</span>}
                </span>
                {r.done ? <Check className="size-4 shrink-0 text-success" aria-label="done" /> : !r.onHide && <Circle className="size-3.5 shrink-0 text-fg-subtle" aria-label="not done" />}
              </Link>
            )}
            {r.onHide && !r.done && (
              <div className={cn("absolute right-1.5", r.detail ? "top-2" : "top-1/2 -translate-y-1/2")}>
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="text-fg-muted" aria-label={`Options: ${r.label}`} disabled={busy}>
                      <Ellipsis aria-hidden />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={r.onHide}>
                      <EyeOff />
                      {hideLabel}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            )}
          </li>
        ))}
      </ul>
      {footer && <div className="border-t border-line px-4 py-2.5 text-xs">{footer}</div>}
    </section>
  );
}
