"use client";

// Lists (UI refactor, Nov 2026), cloudhost's ResourceList: one search field
// ("/" focuses it), a view switch (table or cards), and one table card with
// tall rows — an icon box, the name and a quiet line under it, then the
// columns — and "1–25 of 80" under it. The page (a server component) draws
// each row's cells and its card; this only searches, switches and pages, so
// a list never needs a second copy of its data in the browser's shape.

import Link from "@/components/kit/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LayoutGrid, List as ListIcon, Search, X } from "lucide-react";
import { cn } from "./cn";
import { inputBase } from "./input";
import { CardGrid, EmptyState } from "./page";
import { Pager } from "./pager";
import { Segmented } from "./segmented";
import { withQuery } from "@/components/list-search-model";
import { paginate, PAGE_SIZE } from "@/components/paging";

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName));
};

/**
 * The one search box: a magnifier, a clear button, "/" to focus it.
 *
 *   controlled  `value` + `onChange`: the caller filters (a list in the
 *               browser, ResourceList)
 *   url         `url`: the query lives in ?q= — typing waits a beat, then
 *               replaces the URL (dropping ?page=, so the answer starts at its
 *               first page). For a list the server filters before it pages.
 *               `value` is the query the page was drawn with.
 */
export function SearchField(props: {
  value?: string;
  onChange?: (v: string) => void;
  /** Keep the query in ?q= instead of handing it to onChange. */
  url?: boolean;
  placeholder: string;
  className?: string;
  /** "/" focuses the box. Off where two boxes share a page, or where the
   *  page routes "/" itself (then `slashHint` still shows the key). */
  autoFocusKey?: boolean;
  slashHint?: boolean;
  /** lg (40px) beside a list's toolbar, md (36px) in a page header, sm
   *  (32px) in a side panel. */
  size?: "sm" | "md" | "lg";
  /** A note at the right end of the box ("3 found"), in place of the "/" hint. */
  note?: ReactNode;
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return props.url ? <UrlSearchField {...props} /> : <SearchBox {...props} value={props.value ?? ""} onChange={props.onChange ?? (() => {})} />;
}

function UrlSearchField({ value = "", ...rest }: Parameters<typeof SearchField>[0]) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const change = (next: string) => {
    setQ(next);
    rest.onChange?.(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(`${pathname}${withQuery(params.toString(), next)}`, { scroll: false });
    }, 220);
  };
  return <SearchBox {...rest} value={q} onChange={change} />;
}

function SearchBox({
  value,
  onChange,
  placeholder,
  className,
  autoFocusKey = true,
  slashHint = autoFocusKey,
  size = "lg",
  note,
  id,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  autoFocusKey?: boolean;
  slashHint?: boolean;
  size?: "sm" | "md" | "lg";
  note?: ReactNode;
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const box = useRef<HTMLInputElement>(null);
  React.useImperativeHandle(inputRef, () => box.current as HTMLInputElement);
  useEffect(() => {
    if (!autoFocusKey) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "/" && !typing(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [autoFocusKey]);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted", size === "sm" ? "left-2.5 size-3.5" : "left-3 size-4")} aria-hidden />
      <input
        ref={box}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears and lets go, the way every list's box did.
          if (e.key === "Escape") {
            e.preventDefault();
            if (value) onChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          inputBase,
          size === "sm" ? "h-8 pl-8 text-[13px]" : size === "md" ? "h-9 pl-9" : "h-10 pl-9",
          "pr-10 [&::-webkit-search-cancel-button]:appearance-none",
          note != null && "pr-24",
        )}
      />
      {note != null ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums text-fg-muted">{note}</span>
      ) : value ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onChange("");
            box.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-muted hover:bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      ) : (
        slashHint && <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm border border-line bg-sunken px-1.5 font-mono text-[10px] leading-4 text-fg-muted">/</kbd>
      )}
    </div>
  );
}

export type View = "list" | "grid";

export function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <Segmented
      label="View"
      size="lg"
      value={value}
      onChange={(v) => onChange(v as View)}
      items={[
        { key: "list", icon: <ListIcon />, title: "Table" },
        { key: "grid", icon: <LayoutGrid />, title: "Cards" },
      ]}
    />
  );
}

/** A page of an array a client component owns. A delete on the last page
 *  can leave the stored page past the end; `paginate` clamps, and the
 *  clamped page is what is shown and what the Pager steps from. */
export function usePaged<T>(items: T[], size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  return { ...paginate(items, page, size), setPage };
}

// The chosen view, remembered per list in this browser, read as an outside
// store so the server's first paint (the table) and the client agree.
const VIEW_EVENT = "foldrun:list-view";
function readView(key: string): View | null {
  try {
    const v = localStorage.getItem(`foldrun:view:${key}`);
    return v === "grid" || v === "list" ? v : null;
  } catch {
    return null;
  }
}
function useView(key: string, fallback: View): [View, (v: View) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      window.addEventListener(VIEW_EVENT, cb);
      return () => window.removeEventListener(VIEW_EVENT, cb);
    },
    () => readView(key) ?? fallback,
    () => fallback,
  );
  return [
    v,
    (next) => {
      try {
        localStorage.setItem(`foldrun:view:${key}`, next);
      } catch {}
      window.dispatchEvent(new Event(VIEW_EVENT));
    },
  ];
}

export type Column = {
  key: string;
  header: ReactNode;
  align?: "start" | "end";
  /** Hide below this width. */
  hide?: "sm" | "md" | "lg";
  className?: string;
};

export type Row = {
  key: string;
  /** What the search box matches, lower-cased by the list. */
  search: string;
  href?: string;
  /** The first cell: an icon box, the name, a line under it. */
  icon?: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  /** The other cells, by column key. */
  cells?: Record<string, ReactNode>;
  /** A row's own action at the end (a Run button, a menu). */
  action?: ReactNode;
  /** The card for the cards view. */
  card?: ReactNode;
};

const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" } as const;

/** The table on its own (no search): a card with the head and tall rows. */
export function RowTable({ columns, rows, nameHeader = "Name", empty }: { columns: Column[]; rows: Row[]; nameHeader?: ReactNode; empty?: ReactNode }) {
  const hasAction = rows.some((r) => r.action);
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full caption-bottom text-sm">
        <thead className="bg-sunken">
          <tr className="border-b border-line">
            <th className="h-10 px-3 text-left align-middle text-[13px] font-medium whitespace-nowrap text-fg-muted">{nameHeader}</th>
            {columns.map((c) => (
              <th key={c.key} className={cn("h-10 px-3 align-middle text-[13px] font-medium whitespace-nowrap text-fg-muted", c.align === "end" ? "text-right" : "text-left", c.hide && HIDE[c.hide], c.className)}>
                {c.header}
              </th>
            ))}
            {hasAction && <th className="w-px px-3" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {rows.map((r) => (
            <tr key={r.key} className="relative border-b border-line transition-colors hover:bg-sunken">
              <td className="h-16 px-3 py-2 align-middle">
                <span className="flex min-w-0 items-center gap-3">
                  {r.icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg [&_svg]:size-4">{r.icon}</span>}
                  <span className="min-w-0">
                    {r.href ? (
                      <Link href={r.href} className="block truncate font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium text-fg">{r.name}</span>
                    )}
                    {r.sub && <span className="block max-w-[16rem] truncate text-xs text-fg-muted xl:max-w-[24rem]">{r.sub}</span>}
                  </span>
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className={cn("h-16 max-w-56 px-3 py-2 align-middle whitespace-nowrap text-fg-secondary", c.align === "end" && "text-right tabular-nums", c.hide && HIDE[c.hide], c.className)}>
                  <span className="block truncate [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10 [&_input]:relative [&_input]:z-10">{r.cells?.[c.key] ?? <span className="text-fg-subtle">—</span>}</span>
                </td>
              ))}
              {hasAction && <td className="relative z-10 w-px px-3 py-2 text-right align-middle whitespace-nowrap">{r.action}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * cloudhost's ResourceList: search + view switch + the table (or cards) +
 * paging. `id` keeps the chosen view per list; the search and the page live
 * in the URL (?q=, ?page=) so Back and a shared link keep them.
 */
export function ResourceList({
  id,
  rows,
  columns,
  search = "Search…",
  nameHeader,
  empty,
  noMatch = "Nothing matches.",
  toolbar,
  pageSize = 25,
  views = true,
}: {
  id: string;
  rows: Row[];
  columns: Column[];
  search?: string;
  nameHeader?: ReactNode;
  /** When there are no rows at all. */
  empty?: ReactNode;
  noMatch?: string;
  /** Filters beside the search box. */
  toolbar?: ReactNode;
  pageSize?: number;
  views?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [q, setQState] = useState(urlQ);
  // The search follows the URL: a link or Back to this list with another
  // ?q= (or none) shows that search. What this box wrote itself is not news
  // — typing outruns router.replace, so an older value arriving late must
  // not undo newer keystrokes.
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  const [pending, setPending] = useState<string[]>([]);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    if (pending.includes(urlQ)) {
      if (urlQ === pending[pending.length - 1]) setPending([]);
    } else {
      setQState(urlQ);
      setPending([]);
    }
  }
  const [view, setView] = useView(id, "list");
  const page = Math.max(0, Number(params.get("page") ?? 1) - 1);

  const setUrl = (next: Record<string, string | null>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  };
  const setQ = (v: string) => {
    setQState(v);
    setPending((p) => [...p, v]);
    setUrl({ q: v || null, page: null });
  };

  if (!rows.length && empty) return <>{empty}</>;

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.search.toLowerCase().includes(needle)) : rows;
  const offset = Math.min(page * pageSize, Math.max(0, shown.length - 1 - ((shown.length - 1) % pageSize)));
  const pageRows = shown.slice(offset, offset + pageSize);
  const canCards = views && rows.some((r) => r.card);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder={search} className="min-w-48 flex-1" />
        {toolbar}
        {canCards && <ViewToggle value={view} onChange={setView} />}
      </div>
      {!shown.length ? (
        <EmptyState title={noMatch} compact />
      ) : view === "grid" && canCards ? (
        <CardGrid>
          {pageRows.map((r) => (
            <div key={r.key} className="min-w-0">
              {r.card}
            </div>
          ))}
        </CardGrid>
      ) : (
        <RowTable columns={columns} rows={pageRows} nameHeader={nameHeader} />
      )}
      <Pager
        page={offset / pageSize + 1}
        pages={Math.max(1, Math.ceil(shown.length / pageSize))}
        total={shown.length}
        pageSize={pageSize}
        onPage={(n) => setUrl({ page: n > 1 ? String(n) : null })}
      />
    </div>
  );
}
