// Pager: one control turns every list's pages — "1–25 of 80" and two
// chevrons. Server-safe (no state, no hooks), in two modes:
//
//   links     `base` (+ `tenantParam`): for a list the server pages. The page
//             is ?page= in the URL, so it survives a refresh and can be sent;
//             everything already in `base` is kept, so a filtered list pages
//             within its filter.
//   callback  `onPage`: for a client component that owns its rows (search,
//             upload, delete). Use it from a client component only.
//
// The arithmetic is components/paging.ts; `usePaged` (kit/list.tsx) keeps a
// client page that clamps when the list shrinks under it.
import Link from "@/components/kit/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

const STEP = "flex size-8 items-center justify-center rounded-md border border-line bg-surface text-fg transition-colors";

export function Pager({
  page,
  pages,
  total,
  pageSize,
  base,
  tenantParam = "",
  onPage,
  labels = ["Previous page", "Next page"],
  className,
}: {
  /** 1-based. */
  page: number;
  pages: number;
  /** How many rows in all; with `pageSize`, the line reads "11–20 of 34". */
  total?: number;
  pageSize?: number;
  /** Links mode: the page's path, with or without a query. */
  base?: string;
  /** `&tenant=x` or empty — appended after the page param. */
  tenantParam?: string;
  /** Callback mode. */
  onPage?: (page: number) => void;
  /** The two steps' names — a chronological list reads Newer / Older. */
  labels?: [string, string];
  className?: string;
}) {
  if (total === 0 || (pages <= 1 && total === undefined)) return null;
  const at = (n: number) => `${base ?? ""}${(base ?? "").includes("?") ? "&" : "?"}page=${n}${tenantParam}`;
  // A handler made here, not an inline arrow: this file is server-safe, and
  // callback mode is only ever drawn from a client component.
  const go = (n: number) => () => onPage?.(n);
  const step = (n: number, label: string, enabled: boolean, Icon: typeof ChevronLeft) => {
    if (!enabled)
      return (
        <span aria-hidden className={cn(STEP, "opacity-40")}>
          <Icon className="size-4" />
        </span>
      );
    return (
      <Tooltip label={label}>
        {onPage ? (
          <button type="button" aria-label={label} onClick={go(n)} className={cn(STEP, "hover:bg-sunken")}>
            <Icon className="size-4" />
          </button>
        ) : (
          <Link href={at(n)} aria-label={label} className={cn(STEP, "hover:bg-sunken")}>
            <Icon className="size-4" />
          </Link>
        )}
      </Tooltip>
    );
  };
  const line =
    total !== undefined && pageSize
      ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`
      : total !== undefined && pages <= 1
        ? `${total} total`
        : `Page ${page} of ${pages}${total !== undefined ? ` · ${total} total` : ""}`;
  return (
    <div className={cn("flex items-center justify-between gap-3 pt-3 text-sm text-fg-muted", className)}>
      <span className="tabular-nums">{line}</span>
      {pages > 1 && (
        <span className="flex items-center gap-1">
          {step(page - 1, labels[0], page > 1, ChevronLeft)}
          {step(page + 1, labels[1], page < pages, ChevronRight)}
        </span>
      )}
    </div>
  );
}
