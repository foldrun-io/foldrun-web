"use client";

// The search box every list page gets. Two ways of answering:
//
//   client   the rows are already on the page; typing hides the ones that
//            do not match. The page marks each row with data-search="…"
//            and puts an id on the list. Nothing is fetched.
//
//   url      the list is paged on the server, so filtering what is visible
//            would search one page of ten. Typing writes ?q= into the URL
//            (debounced, page reset) and the page filters before paging.
//
// "/" puts the cursor here from anywhere on the page; Escape clears.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { matchesQuery, withQuery } from "./list-search-model";
import { LIST_SEARCH_EVENT } from "./collapse-model";

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ListSearch({
  mode = "client",
  listId,
  placeholder = "Search…",
  value = "",
  total,
  noun = "results",
  className = "",
}: {
  mode?: "client" | "url";
  /** client mode: the element whose `[data-search]` descendants are the rows. */
  listId?: string;
  placeholder?: string;
  /** url mode: the query the page was rendered with. */
  value?: string;
  /** How many rows the list has (client) or the server left (url). */
  total?: number;
  noun?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(value);
  const [shown, setShown] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (query: string): number => {
    if (mode !== "client" || !listId) return 0;
    const root = document.getElementById(listId);
    if (!root) return 0;
    let n = 0;
    for (const row of root.querySelectorAll<HTMLElement>("[data-search]")) {
      const hit = matchesQuery(`${row.dataset.search ?? ""} ${row.textContent ?? ""}`, query);
      row.hidden = !hit;
      if (hit) n += 1;
    }
    return n;
  };

  const change = (query: string) => {
    setQ(query);
    if (mode === "client") {
      // Collapsed cards open when the search matches them (collapsible-card).
      window.dispatchEvent(new CustomEvent(LIST_SEARCH_EVENT, { detail: { listId, query } }));
      setShown(query.trim() ? apply(query) : (apply(""), null));
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(`${pathname}${withQuery(params.toString(), query)}`);
    }, 220);
  };

  // The rows can be redrawn under us (a refresh after a delete); the filter
  // is reapplied when they are.
  useEffect(() => {
    if (mode !== "client" || !listId) return;
    const root = document.getElementById(listId);
    if (!root) return;
    const observer = new MutationObserver(() => {
      const current = inputRef.current?.value ?? "";
      if (current.trim()) setShown(apply(current));
    });
    observer.observe(root, { childList: true, subtree: false });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, listId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const count = mode === "client" ? (shown ?? total) : total;

  return (
    <div className={`mb-4 flex items-center gap-3 ${className}`}>
      <label className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-subtle"><SearchIcon /></span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              change("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-9 text-sm text-fg placeholder:text-fg-subtle focus:border-gray-400 focus:outline-none"
        />
        <kbd className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[10px] text-fg-subtle">/</kbd>
      </label>
      {count !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {q.trim() && total !== undefined && count !== total ? `${count} of ${total}` : count} {noun}
        </span>
      )}
    </div>
  );
}
