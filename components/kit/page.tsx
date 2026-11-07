// Page patterns (UI refactor, Nov 2026), ported from cloudhost's ui package
// (~/cloudhost.ir/ui: basics.tsx, cards.tsx, settings-card.tsx,
// resource-detail.tsx) without its i18n layer. Server-safe — no state, no
// hooks — so a server page composes them directly; the ones that read the
// URL or keep state are in page-tabs.tsx and list.tsx.
//
//   <Page>                                  the content column
//     <PageHeader title="Agents" … />       a big title, its line, actions
//     <Panel title="Usage">…</Panel>        a section: title outside its card
//     <ResourceCard … />                    a card that leads somewhere
//     <SettingsCard … />                    title, control, footer with save
//
// Widths: narrow (settings, forms), default (lists), wide (tables with many
// columns), full (canvas, editor, graph, trace).
//
// The whole kit — one component per pattern (owner rule, 7 Nov 2026; the
// guard is tests/kit-only.test.ts). Before writing markup, find it here:
//
//   page.tsx        Page, PageHeader, Fact, IconBox, Card, Count, Panel,
//                   PanelLink, SectionTitle, StatusRing, Chip, Tag,
//                   ResourceCard, CardGrid, RingProgress, UsageRows, PanelRow,
//                   PanelList, FactRow, SummaryCard, SettingsCard, EmptyState,
//                   StatGrid, Stat, Banner (bar), Callout (notice), Field
//   list.tsx        ResourceList, RowTable, SearchField (also ?q= mode),
//                   ViewToggle, usePaged
//   pager.tsx       Pager (links or callback)
//   page-tabs.tsx   PageTabs (links or state)
//   segmented.tsx   Segmented (links or buttons; group, tablist, radiogroup)
//   status.tsx      Status, StatusDot — run outcomes
//   button.tsx      Button, buttonVariants
//   input.tsx       Input, Textarea, Label, labelClass, inputBase, Kbd
//   select.tsx      Select              choice.tsx   Checkbox, Switch, RadioGroup
//   combobox.tsx    Combobox            time-field.tsx  TimeField
//   slider.tsx      Slider              file-button.tsx FileButton, useFilePicker
//   disclosure.tsx  Disclosure          tooltip.tsx  Tooltip, IconButton
//   menu.tsx        Menu…               popover.tsx  Popover…
//   dialog.tsx      Dialog, Sheet       confirm.tsx  useConfirm, ConfirmDialog
//   prompt.tsx      usePrompt, useCopyFallback       toast.tsx  Toast
//   table.tsx       Table parts, DataTable           chart.tsx  Sparkbars, Meter, ChartLegend
//   overview.tsx    SplitOverview       skeleton.tsx Skeleton
import * as React from "react";
import Link from "@/components/kit/link";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export type PageWidth = "narrow" | "default" | "wide" | "full";
const WIDTH: Record<PageWidth, string> = {
  narrow: "max-w-[50rem]",
  default: "max-w-[calc(var(--container-page)+3rem)]",
  wide: "max-w-[calc(var(--container-wide)+3rem)]",
  full: "max-w-none",
};

export function Page({ width = "default", className, ...props }: React.ComponentProps<"div"> & { width?: PageWidth }) {
  return <div className={cn("mx-auto w-full min-w-0 px-4 pt-6 sm:px-6", width === "narrow" && "md:pt-10", WIDTH[width], className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  icon,
  meta,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned: one primary action, the rest secondary or in a menu. */
  actions?: React.ReactNode;
  /** Beside the title: a kind tag, a status. */
  badge?: React.ReactNode;
  /** A mark before the title (an icon box or an avatar). */
  icon?: React.ReactNode;
  /** A row of facts under the line. */
  meta?: React.ReactNode;
  /** A way up, shown small above the title. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-8 space-y-3", className)}>
      {back && (
        <Link href={back.href} className="inline-flex min-h-6 items-center gap-1 text-[13px] text-fg-muted transition-colors hover:text-fg">
          <span aria-hidden>‹</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl space-y-1.5">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-2xl font-semibold tracking-tight text-fg md:text-3xl">
            {icon}
            <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
            {badge && <span className="inline-flex flex-wrap items-center gap-2 text-sm font-normal tracking-normal">{badge}</span>}
          </h1>
          {description && <div className="text-sm text-fg-muted">{description}</div>}
          {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-sm text-fg-muted">{meta}</div>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** One fact in a header's meta row: a quiet label and its value. */
export function Fact({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-fg">{children}</span>
    </span>
  );
}

/** A box for an icon: before a name in a row, a card or a title. */
export function IconBox({ children, round = false, hint, className, ...props }: Omit<React.ComponentProps<"span">, "title"> & { round?: boolean; hint?: React.ReactNode }) {
  return (
    <Tooltip label={hint}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center border border-line bg-surface text-fg [&_svg]:size-4", round ? "rounded-full" : "rounded-md", className)} {...props}>
        {children}
      </span>
    </Tooltip>
  );
}

/** A plain card with a hairline. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 overflow-hidden rounded-lg border border-line bg-surface", className)} {...props} />;
}

/** A count beside a title, a tab or a nav item. `strong` for one that asks
 *  to be acted on (filters in force), `warn` for one that needs a look. */
export function Count({ children, tone = "default", className }: { children: React.ReactNode; tone?: "default" | "strong" | "warn"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium leading-5 tabular-nums",
        tone === "strong" ? "bg-ink text-on-ink" : tone === "warn" ? "bg-warning-soft text-warning" : "bg-muted text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A section: its title outside its card (cloudhost's Panel). `flush` when
 *  the body draws its own rows; `count` beside the title. */
export function Panel({
  title,
  description,
  actions,
  count,
  children,
  className,
  bodyClassName,
  flush = false,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** How many: drawn beside the title. */
  count?: number;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 scroll-mt-20 space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 px-1 text-base font-medium text-fg">
            {title}
            {count !== undefined && <Count>{count}</Count>}
          </h2>
          {description && <p className="px-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("min-w-0 overflow-hidden rounded-lg border border-line bg-surface", !flush && "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A panel's "see all" link, beside its title. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-fg transition-colors hover:bg-sunken">
      {children}
      <ChevronRight className="size-3.5 text-fg-muted" aria-hidden />
    </Link>
  );
}

/** A section heading with no card under it (a grid of cards follows). */
export function SectionTitle({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="min-w-0">
        <h2 className="px-1 text-base font-medium text-fg">{title}</h2>
        {description && <p className="px-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- status: a ring for a card, a chip for a line ----

export type RingStatus = "live" | "idle" | "busy" | "error" | "waiting";
const RING: Record<RingStatus, string> = {
  live: "border-success bg-success/15",
  idle: "border-dashed border-line-strong",
  busy: "border-sky-500 bg-sky-500/15",
  error: "border-danger bg-danger/15",
  waiting: "border-violet-500 bg-violet-500/15",
};
const RING_DOT: Record<RingStatus, string> = { live: "bg-success", idle: "", busy: "bg-sky-500 animate-pulse", error: "bg-danger", waiting: "bg-violet-500" };

export function StatusRing({ status, label }: { status: RingStatus; label: string }) {
  return (
    <Tooltip label={label}>
      <span role="img" aria-label={label} className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2", RING[status])}>
        {status !== "idle" && <span className={cn("size-1.5 rounded-full", RING_DOT[status])} />}
      </span>
    </Tooltip>
  );
}

// The marks on a line, and when to use which (one each, no others):
//   Status / StatusDot (status.tsx)  a run's outcome, from outcome-model
//   Chip    a state or a fact with a tone: "Needs you", "regressed",
//           "TEST", "×3" — round, coloured only when the tone means it
//   Tag     what a thing is: a kind, a model, a trigger — square and quiet
//   Count   a number beside a title or a tab
export type Tone = "default" | "good" | "warn" | "bad" | "info";
const CHIP: Record<Tone, string> = {
  default: "border border-line bg-surface text-fg-muted",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
export function Chip({ children, tone = "default", dot = false, pulse = false, hint, className, ...props }: Omit<React.ComponentProps<"span">, "title"> & { tone?: Tone; dot?: boolean; pulse?: boolean; hint?: React.ReactNode }) {
  return (
    <Tooltip label={hint}>
      <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3", CHIP[tone], pulse && "animate-pulse", className)} {...props}>
        {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
        {children}
      </span>
    </Tooltip>
  );
}

/** A quiet label: a kind, a model name. */
export function Tag({ children, mono = false, hint, className, ...props }: Omit<React.ComponentProps<"span">, "title"> & { mono?: boolean; hint?: React.ReactNode }) {
  return (
    <Tooltip label={hint}>
      <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line bg-sunken px-2 text-xs text-fg-secondary [&_svg]:size-3", mono && "font-mono", className)} {...props}>
        {children}
      </span>
    </Tooltip>
  );
}

// ---- ResourceCard: cloudhost's project card ----

export function ResourceCard({
  href,
  icon,
  name,
  sub,
  status,
  statusLabel,
  lines,
  layout = "grid",
  round = true,
  mark,
}: {
  href: string;
  icon?: React.ReactNode;
  /** Drawn as is instead of the icon box (an avatar). */
  mark?: React.ReactNode;
  name: React.ReactNode;
  sub?: React.ReactNode;
  status?: RingStatus;
  statusLabel?: string;
  /** Under the name: what it last did, when it runs next. Each line may
   *  start with a small icon. */
  lines?: React.ReactNode[];
  layout?: "grid" | "list";
  round?: boolean;
}) {
  return (
    <Link href={href} className={cn("group block min-w-0 rounded-lg border border-line bg-surface transition-colors hover:border-line-strong", layout === "grid" ? "p-5" : "px-4 py-3")}>
      <div className="flex min-w-0 items-start gap-3">
        {mark ?? <IconBox round={round}>{icon}</IconBox>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{name}</p>
          {sub && <p className="truncate text-sm text-fg-muted">{sub}</p>}
        </div>
        {status && <StatusRing status={status} label={statusLabel ?? status} />}
      </div>
      {lines?.length ? (
        <div className={cn("min-w-0 space-y-1 text-sm text-fg-muted", layout === "grid" ? "mt-4" : "mt-2 pl-12")}>
          {lines.map((l, i) => (
            <div key={i} className="flex min-w-0 items-center gap-1.5 truncate [&_svg]:size-3.5 [&_svg]:shrink-0">
              {l}
            </div>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

/** The grid ResourceCards sit in. */
export function CardGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]", className)} {...props} />;
}

// ---- usage: a ring per row, used of its limit ----

export function RingProgress({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const tone = v >= 1 ? "text-danger" : v >= 0.8 ? "text-warning" : "text-fg";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("shrink-0 -rotate-90", tone)} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5" className="stroke-line" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5" stroke="currentColor" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
    </svg>
  );
}

export type UsageRow = { key: string; label: React.ReactNode; used: number; limit: number | null; shown: string; href?: string };

/** Rows of what is used, against a limit where there is one (zebra rows). */
export function UsageRows({ rows, heading, action }: { rows: UsageRow[]; heading?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <>
      {(heading || action) && (
        <div className="flex min-h-12 items-center justify-between gap-2 px-4 pb-1 pt-3">
          {heading && <p className="text-sm font-medium text-fg">{heading}</p>}
          {action}
        </div>
      )}
      <ul className="px-2 pb-2">
        {rows.map((r, i) => {
          const body = (
            <>
              <RingProgress value={r.limit ? r.used / r.limit : 0} label={r.shown} />
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="ml-auto shrink-0 text-[13px] tabular-nums text-fg-muted">{r.shown}</span>
            </>
          );
          const cls = cn("flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 text-sm text-fg", i % 2 === 0 && "bg-sunken");
          return <li key={r.key}>{r.href ? <Link href={r.href} className={cn(cls, "hover:bg-muted")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
        {!rows.length && <li className="px-3 py-6 text-center text-sm text-fg-muted">Nothing yet.</li>}
      </ul>
    </>
  );
}

// ---- a row in a panel: a title, a line, chips, an action ----

export function PanelRow({ title, href, message, chips, action, className }: { title: React.ReactNode; href?: string; message?: React.ReactNode; chips?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 px-5 py-3", className)}>
      <div className="min-w-0 flex-1 space-y-1">
        {href ? (
          <Link href={href} className="block truncate text-sm font-medium text-fg hover:underline">
            {title}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium text-fg">{title}</p>
        )}
        {message && <div className="line-clamp-2 text-sm text-fg-muted">{message}</div>}
        {chips && <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{chips}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Rows in a panel, with hairlines between. */
export function PanelList({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("divide-y divide-line", className)} {...props} />;
}

// ---- facts: label over value, in a row ----

export function FactRow({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0 space-y-1">
          <dt className="text-[13px] text-fg-muted">{it.label}</dt>
          <dd className="min-w-0 truncate text-sm text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The facts as one card: status, created, owner… */
export function SummaryCard({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface p-4 sm:p-5", className)}>
      <FactRow items={items} />
    </section>
  );
}

// ---- settings ----

/** cloudhost's settings card: the title and what it does, the control, and a
 *  footer with a note on the left and the save on the right. `danger` for
 *  the Danger zone, always last on a page. */
export function SettingsCard({
  title,
  description,
  children,
  footer,
  hint,
  danger = false,
  tone,
  id,
  actions,
  flush = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** The save, or the action. Right-aligned in the footer. */
  footer?: React.ReactNode;
  /** A quiet sentence left of the footer's action. */
  hint?: React.ReactNode;
  danger?: boolean;
  /** Older spelling of danger. */
  tone?: "danger";
  id?: string;
  /** Beside the title (Add, Invite). */
  actions?: React.ReactNode;
  /** The body draws its own rows: no padding, a hairline above. */
  flush?: boolean;
  className?: string;
}) {
  const isDanger = danger || tone === "danger";
  return (
    <section id={id} className={cn("mb-6 min-w-0 scroll-mt-24 overflow-hidden rounded-lg border bg-surface", isDanger ? "border-danger/40" : "border-line", className)}>
      <div className={cn("space-y-3 p-5 sm:p-6", flush && "pb-3 sm:pb-3")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-lg font-semibold text-fg">{title}</h2>
            {description && <div className="text-sm text-fg-muted">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && !flush && <div className="min-w-0 pt-1">{children}</div>}
      </div>
      {children && flush && <div className="min-w-0 border-t border-line">{children}</div>}
      {(footer || hint) && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm text-fg-muted sm:px-6", isDanger ? "border-danger/30 bg-danger-soft" : "border-line bg-sunken")}>
          <div className="min-w-0">{hint}</div>
          {footer && <div className="flex shrink-0 items-center gap-2">{footer}</div>}
        </div>
      )}
    </section>
  );
}

// ---- empty, tiles, banners, fields ----

/** Nothing here yet: what this place is for, and the one thing to do. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  bare = false,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
  /** Inside a card already: no border of its own. */
  bare?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 text-center", compact ? "py-8" : "py-12", !bare && "rounded-lg border border-line bg-surface", className)}>
      {icon && <span className="mb-1 flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted [&_svg]:size-5">{icon}</span>}
      <p className="font-medium text-fg">{title}</p>
      {description && <div className="max-w-md text-sm text-fg-muted">{description}</div>}
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** KPI tiles, cloudhost's StatTile: separate cards in a grid. */
export function StatGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4", className)} {...props} />;
}

export function Stat({
  label,
  value,
  sub,
  tone,
  href,
  icon,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "danger" | "warning" | "success";
  href?: string;
  icon?: React.ReactNode;
}) {
  const body = (
    <div className={cn("h-full space-y-1.5 rounded-lg border border-line bg-surface px-3 py-3 sm:space-y-2 sm:px-4 sm:py-4", href && "transition-colors hover:border-line-strong hover:bg-sunken")}>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("flex min-w-0 items-center gap-1.5 text-xl font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-2xl", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-fg")}>
        {value}
      </div>
      {sub && <div className="text-xs text-fg-muted">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A full-width notice under the bar. */
export function Banner({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "neutral" | "accent";
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = {
    info: "border-info-line bg-info-soft text-info",
    warning: "border-warning-line bg-warning-soft text-warning",
    danger: "border-danger-line bg-danger-soft text-danger",
    neutral: "border-line bg-sunken text-fg-secondary",
    accent: "border-transparent bg-ink text-on-ink",
  }[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-[13px] sm:px-6", t, className)}>
      <div className="min-w-0 flex-1">
        {title && <span className="font-semibold">{title}</span>}
        {title && children && <span className="opacity-60"> · </span>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-3 text-[13px] font-medium [&_a]:underline [&_a]:underline-offset-2">{action}</div>}
    </div>
  );
}

/** A notice inside a page: what just happened, what is wrong, what to do.
 *  (Banner is the full-width bar under the top bar; this sits in the
 *  content.) One line is tinted in its tone; with a `title` the title leads
 *  and the body reads quietly. `size="sm"` for a note under a control. */
export type CalloutTone = "neutral" | "info" | "success" | "warning" | "danger";
const CALLOUT: Record<CalloutTone, { box: string; text: string }> = {
  neutral: { box: "border-line bg-sunken", text: "text-fg-secondary" },
  info: { box: "border-info-line bg-info-soft", text: "text-info" },
  success: { box: "border-success-line bg-success-soft", text: "text-success" },
  warning: { box: "border-warning-line bg-warning-soft", text: "text-warning" },
  danger: { box: "border-danger-line bg-danger-soft", text: "text-danger" },
};
export function Callout({
  tone = "neutral",
  icon,
  title,
  actions,
  size = "md",
  children,
  className,
  bodyClassName,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  tone?: CalloutTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  /** Right of the text: a link, a button. */
  actions?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Classes for the text column (spacing between its paragraphs). */
  bodyClassName?: string;
}) {
  const t = CALLOUT[tone];
  const pad = size === "sm" ? "gap-2 rounded-md px-2.5 py-1.5 text-xs" : size === "lg" ? "gap-3 rounded-lg p-4 text-sm" : "gap-3 rounded-md px-3 py-2 text-sm";
  return (
    <div className={cn("flex min-w-0 flex-wrap items-start border sm:flex-nowrap", pad, t.box, !title && t.text, className)} {...props}>
      {icon && <span className={cn("mt-0.5 shrink-0", size === "lg" ? "[&_svg]:size-5" : "[&_svg]:size-4", t.text)} aria-hidden>{icon}</span>}
      <div className={cn("min-w-0 flex-1", bodyClassName)}>
        {title && <p className="font-medium text-fg">{title}</p>}
        {children != null && children !== false && <div className={cn(title && "mt-1 text-fg-secondary")}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A label above a control, with an optional hint under it. Without
 *  `htmlFor` the whole field is the <label>, so the control inside is named
 *  by it; with one, the label points at that id. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  const note = error ? <span className="block text-xs text-danger">{error}</span> : hint ? <span className="block text-xs text-fg-muted">{hint}</span> : null;
  if (!htmlFor) {
    return (
      <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {children}
        {note}
      </label>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {note}
    </div>
  );
}
