// Cal.com-style UI primitives. @calcom/ui isn't published to npm (it's
// internal to the cal.com monorepo), so these recreate its design language —
// light surfaces, gray-900 primary actions, subtle borders, 6px radii —
// as plain Tailwind components with the same component vocabulary
// (Button, Badge, EmptyScreen, horizontal tabs).

import Link from "next/link";
import type { ReactNode } from "react";

// ---------- Button ----------

export type ButtonColor = "primary" | "secondary" | "minimal" | "destructive";

// Same box as the form atoms below — py-1.5, text-sm line-height, and a
// border on every variant (transparent where invisible) — so a button sat
// beside an input or select lands at the same height instead of 4px short.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40";

export const BUTTON_STYLES: Record<ButtonColor, string> = {
  primary: `${BUTTON_BASE} border-transparent bg-ink text-on-ink hover:bg-ink-hover px-3 py-1.5 shadow-sm`,
  secondary: `${BUTTON_BASE} border-line-strong bg-surface text-fg hover:bg-sunken px-3 py-1.5 shadow-sm`,
  minimal: `${BUTTON_BASE} border-transparent text-fg-tertiary hover:bg-muted hover:text-fg px-3 py-1.5`,
  destructive: `${BUTTON_BASE} border-line-strong bg-surface text-fg hover:border-red-200 hover:bg-red-50 hover:text-red-700 px-3 py-1.5 shadow-sm`,
};

export function buttonClass(color: ButtonColor = "primary", extra = "") {
  return `${BUTTON_STYLES[color]} ${extra}`.trim();
}

/** Chip-scale button — same box as Badge (px-1.5 py-0.5 text-xs), for the
 *  rare action that lives inside a badge row, where a full-height button
 *  would break the line. Anywhere else, use buttonClass. */
export const CHIP_BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-fg-tertiary transition-colors hover:bg-sunken hover:text-fg";
export function chipButtonClass(extra = "") {
  return `${CHIP_BUTTON_CLASS} ${extra}`.trim();
}

/** The "+ Add …" affordance: a full-width dashed row that opens into a form.
 *  Existed as three hand-rolled copies that had already drifted. */
export const DASHED_BUTTON_CLASS =
  "w-full rounded-md border border-dashed border-line-strong px-2 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-gray-400 hover:text-fg";
export function dashedButtonClass(extra = "") {
  return `${DASHED_BUTTON_CLASS} ${extra}`.trim();
}


// ---------- Form atoms ----------
//
// One spelling for every input, select and checkbox. These existed as four
// hand-rolled className constants that had already drifted (rounded vs
// rounded-lg, px-2 vs px-3); a form control that isn't an atom is a fork
// waiting to happen. Selects style the closed control only — the opened
// menu is the OS's, which is native <select>'s accessibility bargain.

export const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg " +
  "placeholder:text-fg-subtle focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-line " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export const SELECT_CLASS =
  "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg-secondary " +
  "focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-line";

export const FIELD_LABEL_CLASS = "block text-[10px] font-medium uppercase tracking-wide text-fg-subtle";

export function inputClass(extra = "") {
  return `${INPUT_CLASS} ${extra}`.trim();
}
export function selectClass(extra = "") {
  return `${SELECT_CLASS} ${extra}`.trim();
}

/** The sub-hierarchy below PageHeader — settings sections, card groups. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-fg">{children}</h2>;
}

export function ButtonLink({
  href,
  color = "secondary",
  children,
  className = "",
}: {
  href: string;
  color?: ButtonColor;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(color, className)}>
      {children}
    </Link>
  );
}

// ---------- Badge ----------

export type BadgeVariant = "default" | "success" | "error" | "warning" | "info";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default: "bg-muted text-gray-800",
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  warning: "bg-orange-100 text-orange-800",
  info: "bg-blue-100 text-blue-800",
};

export function Badge({
  variant = "default",
  children,
  className = "",
  pulse = false,
  title,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  pulse?: boolean;
  /** Hover detail — e.g. the raw cron behind a humanised schedule. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${BADGE_STYLES[variant]} ${pulse ? "animate-pulse" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

// Run/step status → Cal badge variant, in one place.
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: "success",
  failed: "error",
  // Neutral, not red: a person chose this. Stopping must not look like
  // breaking, or nobody dares use the button.
  stopped: "default",
  running: "warning",
  queued: "default",
  pending: "default",
  skipped: "default",
  // A step waiting for room to start (27 Oct 2026): not a problem, news.
  "waiting for room": "info",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "default"} pulse={status === "running"}>
      {status}
    </Badge>
  );
}

// A run's verdict → badge variant. BLOCKED is red and BAD amber: both are
// news a person must act on, even though the run itself completed. GOOD and
// QUIET are the expected endings, so they stay quiet in the row.
const VERDICT_VARIANT: Record<string, BadgeVariant> = {
  BLOCKED: "error",
  BAD: "warning",
  GOOD: "success",
  QUIET: "default",
};
const VERDICT_TITLE: Record<string, string> = {
  BLOCKED: "The run completed, but its work refused itself — nothing was done. Read the summary.",
  BAD: "The run completed and found something wrong.",
  GOOD: "The run completed and did what it set out to.",
  QUIET: "The run completed and found nothing to do.",
};

/** What a completed run's work concluded — the word its summary leads with.
 *  Beside the status, never instead of it: the status says the machine ran,
 *  the verdict what the agents found. Nothing for a run without one. */
export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return null;
  return (
    <Badge variant={VERDICT_VARIANT[verdict] ?? "default"} title={VERDICT_TITLE[verdict]}>
      {verdict}
    </Badge>
  );
}

/** A test run's mark, beside its status wherever a run is listed. One
 *  component so the runs list and the run page cannot say it differently. */
export function TestBadge() {
  return (
    <Badge variant="info" title="A test run: every step ran, nothing outward happened, state/ and storage/ were left alone">
      TEST
    </Badge>
  );
}

// ---------- Icon actions ----------

/**
 * A square, icon-only action with the words on hover.
 *
 * Icon buttons were being hand-rolled per page with a `title` attribute for
 * the explanation — which arrives after a browser delay, renders in the OS's
 * own chrome, and never appears for keyboard users at all. This puts one
 * spelling in the kit: the label is the accessible name AND the visible
 * tooltip, and it shows on focus as well as hover.
 */
export function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  tone = "default",
  side = "top",
  className = "",
}: {
  /** What this does, in words — the tooltip and the accessible name. */
  label: string;
  onClick: () => void;
  /** The icon. Size it here; the button only pads. */
  children: ReactNode;
  disabled?: boolean;
  tone?: "default" | "destructive";
  /** Where the tooltip sits. `top` unless the control is near the top edge. */
  side?: "top" | "bottom" | "right";
  className?: string;
}) {
  const place =
    side === "right"
      ? "left-full top-1/2 ml-1.5 -translate-y-1/2"
      : side === "bottom"
        ? "top-full left-1/2 mt-1.5 -translate-x-1/2"
        : "bottom-full left-1/2 mb-1.5 -translate-x-1/2";
  return (
    <span className="group/icon relative inline-flex">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`rounded p-1 text-fg-subtle transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${
          tone === "destructive"
            ? "hover:bg-red-50 hover:text-red-600"
            : "hover:bg-muted hover:text-fg"
        } ${className}`}
      >
        {children}
      </button>
      {/* pointer-events-none so the tooltip can never eat the click it
          describes — a label that intercepts its own button is a trap.
          Not rendered until hover or focus: an invisible absolutely-placed
          label still counts toward the page's width, and a row of these at
          the right edge gave every page with them a horizontal scrollbar. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-20 hidden whitespace-nowrap rounded-md bg-ink px-1.5 py-1 text-[11px] font-medium text-on-ink shadow-sm group-hover/icon:inline-block group-focus-within/icon:inline-block ${place}`}
      >
        {label}
      </span>
    </span>
  );
}

/** ▶ — start something. */
export function PlayIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3 1.8v8.4c0 .5.5.8.9.5l6.3-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}

// ---------- Surfaces ----------

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>
  );
}

// Cal.com's EmptyScreen: dashed border, centered icon bubble, title,
// description, optional call to action.
export function EmptyScreen({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-fg-tertiary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <div className="mt-1 max-w-md text-sm leading-relaxed text-fg-muted">{description}</div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

// ---------- Horizontal tabs (Cal's HorizontalTabs) ----------

export function HorizontalTabs({
  tabs,
}: {
  tabs: { name: string; href: string; active?: boolean }[];
}) {
  return (
    <nav className="flex items-center gap-1">
      {tabs.map((t) => (
        <Link
          key={t.name}
          href={t.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            t.active ? "bg-muted text-fg" : "text-fg-muted hover:bg-sunken hover:text-fg"
          }`}
        >
          {t.name}
        </Link>
      ))}
    </nav>
  );
}

// ---------- Page scaffolding ----------

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  // No flex-wrap on the header itself: with it, any long subtitle pushed the
  // action onto a second row, bottom-left — so "the New button is always
  // top-right" was true in source and false on screen exactly where
  // subtitles were longest.
  //
  // But the action must still be allowed to shrink. Pinned with shrink-0, an
  // open create form — name box, two selects, two buttons — took its full
  // natural width and crushed the title column to about one word per line,
  // which is what a page looks like when nobody tested the header with a
  // form in it. It wraps inside its own column instead: the action stays
  // right, the title keeps a readable share, and neither jumps.
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-cal text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
      )}
    </header>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: ReactNode; tone?: "error" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 font-cal text-2xl font-semibold tracking-tight ${tone === "error" ? "text-red-600" : "text-fg"}`}>{value}</p>
    </Card>
  );
}
