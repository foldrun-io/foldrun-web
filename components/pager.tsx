"use client";

// One pager for every list in the dashboard.
//
// Lists grow. A workspace's storage, its evals' history, its revisions, the
// account's runs — each was rendered whole, which is fine at eight rows and a
// wall at eight hundred. Ten rows a page is the rule here, and one control
// draws the pages so every list turns the same way.
//
// Two flavours, same markup:
//   - `Pager`: links, for server-rendered lists. The page is a URL param, so
//     it survives refresh and can be sent to someone.
//   - `usePaged` + `PagerControls`: state, for client components that own an
//     array and mutate it (upload, delete). The page clamps itself when the
//     list shrinks under it.

import Link from "next/link";
import { useState } from "react";
import { paginate, PAGE_SIZE } from "./paging";

const LINK = "rounded-md px-2.5 py-1 text-xs font-medium text-fg-tertiary ring-1 ring-inset ring-line hover:bg-sunken";
const DEAD = "rounded-md px-2.5 py-1 text-xs font-medium text-gray-300 ring-1 ring-inset ring-line-faint";

function Frame({
  page,
  pages,
  total,
  prev,
  next,
}: {
  page: number;
  pages: number;
  total?: number;
  prev: React.ReactNode;
  next: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-fg-muted">
      {total != null && <span className="mr-auto tabular-nums text-fg-subtle">{total} total</span>}
      {prev}
      <span className="tabular-nums">
        page {page} of {pages}
      </span>
      {next}
    </div>
  );
}

/**
 * Link-based pager. `base` is the page's path, with or without a query; the
 * page param is appended and everything already in `base` is kept, so a
 * filtered list pages within its filter.
 */
export function Pager({
  base,
  page,
  pages,
  total,
  tenantParam = "",
  labels = ["← Previous", "Next →"],
}: {
  base: string;
  page: number;
  pages: number;
  total?: number;
  /** `&tenant=x` or empty — appended after the page param. */
  tenantParam?: string;
  /** [previous, next]. Chronological lists read better as newer/older. */
  labels?: [string, string];
}) {
  if (pages <= 1) return null;
  const sep = base.includes("?") ? "&" : "?";
  const at = (n: number) => `${base}${sep}page=${n}${tenantParam}`;
  const link = (n: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link href={at(n)} className={LINK}>
        {label}
      </Link>
    ) : (
      <span className={DEAD}>{label}</span>
    );
  return (
    <Frame
      page={page}
      pages={pages}
      total={total}
      prev={link(page - 1, labels[0], page > 1)}
      next={link(page + 1, labels[1], page < pages)}
    />
  );
}

/** Client-side paging over an array the component owns. A delete on the
 *  last page can leave the stored page past the end; `paginate` clamps, and
 *  the clamped page is what is shown and what the controls step from. */
export function usePaged<T>(items: T[], size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  return { ...paginate(items, page, size), setPage };
}

export function PagerControls({
  page,
  pages,
  total,
  onPage,
  labels = ["← Previous", "Next →"],
}: {
  page: number;
  pages: number;
  total?: number;
  onPage: (n: number) => void;
  labels?: [string, string];
}) {
  if (pages <= 1) return null;
  const button = (n: number, label: string, enabled: boolean) =>
    enabled ? (
      <button type="button" onClick={() => onPage(n)} className={LINK}>
        {label}
      </button>
    ) : (
      <span className={DEAD}>{label}</span>
    );
  return (
    <Frame
      page={page}
      pages={pages}
      total={total}
      prev={button(page - 1, labels[0], page > 1)}
      next={button(page + 1, labels[1], page < pages)}
    />
  );
}
