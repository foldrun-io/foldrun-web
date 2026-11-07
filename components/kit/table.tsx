// Table: the parts of a plain data table — a card with hairline rows, a quiet
// head — and DataTable, the whole table from columns and rendered cells.
// Server-safe: plain elements and class names, no state. A list of things
// (agents, flows, keys) is ResourceList / RowTable in list.tsx instead.
import * as React from "react";
import Link from "@/components/kit/link";
import { cn } from "./cn";

export function TableCard({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line bg-sunken", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line-faint [&>tr:last-child]:border-0", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors has-[a[data-row-link]:hover]:bg-sunken", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-9 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-fg-muted first:pl-4 last:pr-4", className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-2.5 align-middle text-fg-secondary", className)} {...props} />;
}

export interface DataColumn {
  label: React.ReactNode;
  align?: "left" | "right";
  /** A width class, when a column should not flex. */
  width?: string;
}

export interface DataRow {
  key: string;
  cells: React.ReactNode[];
  /** The first cell links here. */
  href?: string;
  /** A row that is not settled — a live run, a suspended account. */
  tone?: "warn" | "error";
}

/** A table of figures from columns and rendered cells (not render
 *  functions, so a server page can pass them): one head, one empty line,
 *  one hover, a minimum width so it scrolls inside its card. */
export function DataTable({
  columns,
  rows,
  empty = "Nothing here.",
  title,
  action,
  minWidth = "min-w-[640px]",
}: {
  columns: DataColumn[];
  rows: DataRow[];
  empty?: React.ReactNode;
  /** A caption in the card's head row. */
  title?: React.ReactNode;
  /** Right of the caption: a link, a count, a button. */
  action?: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <TableCard>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-line-faint px-4 py-2">
          <p className="text-[13px] text-fg-muted">{title}</p>
          {action && <div className="text-xs text-fg-muted">{action}</div>}
        </div>
      )}
      <Table className={cn("text-sm", minWidth)}>
        <thead>
          <tr className="border-b border-line-faint">
            {columns.map((c, i) => (
              <TH key={i} className={cn("h-10 text-[13px]", c.align === "right" ? "text-right" : "text-left", c.width)}>
                {c.label}
              </TH>
            ))}
          </tr>
        </thead>
        <TBody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-fg-subtle">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className={cn("align-top hover:bg-sunken", r.tone === "error" && "bg-danger-soft/40", r.tone === "warn" && "bg-warning-soft/40")}>
                {r.cells.map((cell, i) => (
                  <TD key={i} className={cn("py-2 text-sm text-fg", columns[i]?.align === "right" && "text-right tabular-nums")}>
                    {r.href && i === 0 ? (
                      <Link href={r.href} className="font-medium text-fg hover:underline">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </TD>
                ))}
              </tr>
            ))
          )}
        </TBody>
      </Table>
    </TableCard>
  );
}
