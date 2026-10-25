// The atoms a data page is made of.
//
// Tables, filter chips, titled lists, health dots, bar strips, key–value
// stacks. Every dashboard and admin page was rolling its own copy of each,
// with the same classes typed out slightly differently, and the same
// header, the same empty state, the same hover, drifting page by page.
//
// These take rendered cells, not render functions: a server component may
// not hand a function to a client one, and a table that takes ReactNode[][]
// works on either side of that line without anyone thinking about it.

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./ui";

// ---------------------------------------------------------------- table

export interface Column {
  label: ReactNode;
  align?: "left" | "right";
  /** Tailwind width class, when a column should not flex. */
  width?: string;
}

export interface Row {
  key: string;
  cells: ReactNode[];
  /** Whole row is a link. Cells that are links themselves still work. */
  href?: string;
  /** A row that is not settled — a live run, a suspended account. */
  tone?: "warn" | "error";
}

const TH = "px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-subtle";
const TD = "px-4 py-2 text-sm";

/** A table with one header style, one empty state, one hover, one minimum
 *  width so it scrolls inside its card rather than the page. */
export function DataTable({
  columns,
  rows,
  empty = "Nothing here.",
  title,
  action,
  minWidth = "min-w-[640px]",
}: {
  columns: Column[];
  rows: Row[];
  empty?: ReactNode;
  /** A caption in the card's header row. */
  title?: ReactNode;
  /** Something on the right of the caption: a link, a count, a button. */
  action?: ReactNode;
  minWidth?: string;
}) {
  return (
    <Card className="overflow-x-auto">
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-line-faint px-4 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{title}</p>
          {action && <div className="text-xs text-fg-muted">{action}</div>}
        </div>
      )}
      <table className={`w-full ${minWidth}`}>
        <thead>
          <tr className="border-b border-line-faint">
            {columns.map((c, i) => (
              <th key={i} className={`${TH} ${c.align === "right" ? "text-right" : "text-left"} ${c.width ?? ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-faint">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-fg-subtle">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.key}
                className={`align-top hover:bg-sunken ${r.tone === "error" ? "bg-red-50/40" : r.tone === "warn" ? "bg-amber-50/40" : ""}`}
              >
                {r.cells.map((cell, i) => (
                  <td key={i} className={`${TD} ${columns[i]?.align === "right" ? "text-right tabular-nums" : ""}`}>
                    {r.href && i === 0 ? (
                      <Link href={r.href} className="font-medium text-fg hover:underline">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ----------------------------------------------------------------- chips

/** A row of exclusive choices, each a link: statuses, windows, kinds. The
 *  chosen one is dark. Links rather than buttons so a choice is a URL a
 *  person can bookmark and share. */
export function FilterChips({ chips, className = "" }: { chips: { label: ReactNode; href: string; active: boolean }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {chips.map((c, i) => (
        <Link
          key={i}
          href={c.href}
          aria-current={c.active ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            c.active ? "border-gray-900 bg-ink text-on-ink" : "border-line bg-surface text-fg-tertiary hover:border-line-strong"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- lists

/** A titled list with a count and a tone. For "things that need a look":
 *  suspended accounts, broken providers, stuck runs. Renders nothing when
 *  empty unless told to say so — an empty warning card is noise. */
export function TitledList({
  title,
  items,
  tone,
  empty,
  max = 8,
}: {
  title: ReactNode;
  items: ReactNode[];
  tone?: "warn" | "error";
  /** When given, an empty list still renders with this line. */
  empty?: ReactNode;
  max?: number;
}) {
  if (items.length === 0 && !empty) return null;
  const border = tone === "error" ? "border-red-200 bg-red-50/40" : tone === "warn" ? "border-amber-200 bg-amber-50/40" : "";
  const head = tone === "error" ? "border-red-100 text-red-700" : tone === "warn" ? "border-amber-100 text-amber-800" : "border-line-faint text-fg-muted";
  return (
    <Card className={border ? `border ${border}` : ""}>
      <p className={`border-b px-4 py-2 text-xs font-medium uppercase tracking-wide ${head}`}>
        {title}
        {items.length > 0 && <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">· {items.length}</span>}
      </p>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-fg-subtle">{empty}</p>
      ) : (
        <ul className="divide-y divide-line-faint/80 text-sm">
          {items.slice(0, max).map((it, i) => (
            <li key={i} className="px-4 py-2">
              {it}
            </li>
          ))}
          {items.length > max && <li className="px-4 py-2 text-xs text-fg-subtle">and {items.length - max} more</li>}
        </ul>
      )}
    </Card>
  );
}

/** Label on the left, value on the right, stacked. For the small facts
 *  beside a big number. */
export function KeyValue({ rows, className = "" }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs ${className}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="text-right tabular-nums text-gray-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- health

/** Up, down, or not configured. Three states, because "grey" and "red" are
 *  different answers to "is Redis working". */
export function HealthDot({ ok, className = "" }: { ok: boolean | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${ok === null ? "bg-gray-300" : ok ? "bg-emerald-500" : "bg-red-500"} ${className}`}
    />
  );
}

// ------------------------------------------------------------------ bars

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
    <div className={`flex items-end gap-[3px] ${className}`} style={{ height }}>
      {bars.map((b) => (
        <div key={b.key} className="flex flex-1 items-end gap-px" title={b.title}>
          <span className="w-full rounded-sm bg-gray-800/80" style={{ height: `${Math.max(1, (b.value / max) * height)}px` }} />
          {b.second !== undefined && (
            <span className="w-full rounded-sm bg-emerald-400" style={{ height: `${Math.max(1, (b.second / max) * height)}px` }} />
          )}
        </div>
      ))}
    </div>
  );
}

/** A fraction as a bar with marks — a budget against its cap, with the
 *  warning thresholds drawn where they fire. */
export function Meter({ fraction, marks = [], tone }: { fraction: number; marks?: number[]; tone?: "warn" | "error" }) {
  const pct = Math.min(100, Math.max(0, fraction * 100));
  const fill = tone === "error" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : "bg-gray-800";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      {marks.map((m) => (
        <span key={m} className="absolute inset-y-0 w-px bg-surface/80" style={{ left: `${m}%` }} title={`${m}%`} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------- statuses

/** Search-and-filter row for a server-rendered list: a text field and
 *  optional selects, submitted as a GET so the result is a URL. */
export function SearchForm({
  q,
  placeholder,
  selects = [],
  clearHref,
}: {
  q: string;
  placeholder: string;
  selects?: { name: string; value: string; options: { value: string; label: string }[] }[];
  clearHref?: string;
}) {
  const active = q || selects.some((s) => s.value);
  return (
    <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="h-9 w-72 rounded-md border border-line bg-surface px-3 text-sm focus:border-gray-400 focus:outline-none"
      />
      {selects.map((s) => (
        <select key={s.name} name={s.name} defaultValue={s.value} className="h-9 rounded-md border border-line bg-surface px-2 text-sm">
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:border-line-strong">Find</button>
      {active && clearHref && (
        <Link href={clearHref} className="text-xs text-fg-muted hover:text-fg">
          clear
        </Link>
      )}
    </form>
  );
}
