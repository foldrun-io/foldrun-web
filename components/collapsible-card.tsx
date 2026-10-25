"use client";

// The one way a long list of cards collapses.
//
// Flows, evals, storage desks, usage per workspace: each page listed every
// item fully open, so a workspace with ten flows drew ten React Flow canvases
// and the page was a scroll of bodies nobody was reading. Now every item is a
// header — name, a few chips, its buttons — and the body underneath opens on
// click. One component so the gesture is learned once.
//
//   header    always visible. The chevron and title are the toggle (a real
//             <button> with aria-expanded/aria-controls); `meta` chips and
//             `actions` sit beside it, NOT inside it, so Run or Delete never
//             opens the card by accident.
//   body      not mounted until first opened — the canvas costs nothing while
//             the card is shut — then kept (hidden) so an unsaved editor
//             survives a collapse.
//   memory    each viewer's choice per page+item in localStorage; every access
//             is guarded (collapse-model.ts) and the page renders correctly
//             without it.
//   forced    a search that matches the item, the URL's #anchor naming it, or
//             the page saying it must be seen (`forceOpen`) opens it; a click
//             still wins.
//
// <CollapseAll scope=…/> above a list opens or shuts every card in that scope;
// setCardsOpen(scope, open, item?) does the same from code (an upload opens
// the desk it landed in).

import { useEffect, useState, useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { collapseKey, readStored, writeStored, resolveOpen, hashTargets, LIST_SEARCH_EVENT, type CollapseStorage } from "./collapse-model";
import { matchesQuery } from "./list-search-model";

const CHANGE = "foldrun:collapse";
const ALL = "foldrun:collapse-all";

// When storage is refused the choice still holds for this page's life.
const memory = new Map<string, boolean>();

function storage(): CollapseStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function remember(key: string, open: boolean) {
  memory.set(key, open);
  writeStored(storage(), key, open);
  window.dispatchEvent(new Event(CHANGE));
}

function subscribeStored(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE, cb);
  };
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`mt-[3px] shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function CollapsibleCard({
  id,
  scope,
  item,
  title,
  subtitle,
  meta,
  actions,
  search,
  defaultOpen = false,
  forceOpen = false,
  alwaysOpen = false,
  inline = false,
  before,
  borderClass = "border-line",
  className = "",
  bodyClassName = "border-t border-line-faint px-4 pb-4 pt-3",
  children,
  ...rest
}: {
  /** The element id, and the #anchor that opens it. */
  id: string;
  /** The page's list, e.g. `flows:<workspace>` — keys storage and <CollapseAll>. */
  scope: string;
  /** This item's stable name within the scope. */
  item: string;
  title: ReactNode;
  /** Under the title, inside the toggle. */
  subtitle?: ReactNode;
  /** Chips beside or under the title — outside the toggle, may be interactive. */
  meta?: ReactNode;
  /** Right-hand buttons. Never toggle. */
  actions?: ReactNode;
  /** Text a list search matches against; a match opens the card. */
  search?: string;
  defaultOpen?: boolean;
  /** The page needs it seen (errors, a search result). */
  forceOpen?: boolean;
  /** No header, no toggle — the body alone (a list of one). */
  alwaysOpen?: boolean;
  /** One-row header: meta sits on the title's line, not under it. */
  inline?: boolean;
  /** Rendered first inside the card, e.g. an absolutely placed overlay. */
  before?: ReactNode;
  borderClass?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "id" | "title" | "children" | "className">) {
  const key = collapseKey(scope, item);
  const stored = useSyncExternalStore(
    subscribeStored,
    () => readStored(storage(), key) ?? memory.get(key) ?? null,
    () => null,
  );
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const [manual, setManual] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query: string }>).detail?.query ?? "";
      setQuery(q);
      setManual(null); // a new search decides again what is open
    };
    const onAll = (e: Event) => {
      const d = (e as CustomEvent<{ scope: string; open: boolean; item?: string }>).detail;
      if (d?.scope !== scope || (d.item !== undefined && d.item !== item)) return;
      setManual(d.open);
      remember(key, d.open);
    };
    window.addEventListener(LIST_SEARCH_EVENT, onSearch);
    window.addEventListener(ALL, onAll);
    return () => {
      window.removeEventListener(LIST_SEARCH_EVENT, onSearch);
      window.removeEventListener(ALL, onAll);
    };
  }, [scope, item, key]);

  const searchHit = search !== undefined && query.trim() !== "" && matchesQuery(search, query);
  const open =
    alwaysOpen || resolveOpen({ manual, forced: forceOpen || searchHit || hashTargets(hash, id), stored, defaultOpen });

  // Mount the body on first open and keep it: adjusting state during render
  // is React's pattern for state derived from a change.
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);

  const toggle = () => {
    setManual(!open);
    remember(key, !open);
  };
  const bodyId = `${id}-body`;

  return (
    <section
      id={id}
      className={`group relative scroll-mt-4 overflow-hidden rounded-xl border bg-surface shadow-sm ${borderClass} ${className}`}
      {...rest}
    >
      {before}
      {!alwaysOpen && (
        <header className={`flex flex-wrap gap-x-3 gap-y-2 px-4 ${inline ? "items-center py-2.5" : "items-start py-3"}`}>
          <div className={`min-w-0 flex-1 ${inline ? "flex flex-wrap items-center gap-x-3 gap-y-1" : ""}`}>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={bodyId}
              className="flex min-w-0 max-w-full items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              <Chevron open={open} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-fg">{title}</span>
                {subtitle && <span className="mt-0.5 block truncate text-xs text-fg-muted">{subtitle}</span>}
              </span>
            </button>
            {meta && <div className={`flex flex-wrap items-center gap-1 ${inline ? "" : "mt-1.5 pl-5"}`}>{meta}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div id={bodyId} hidden={!open} className={alwaysOpen ? "" : bodyClassName}>
        {seen || open ? children : null}
      </div>
    </section>
  );
}

/** Open or shut cards from outside them: every card in `scope`, or one `item`. */
export function setCardsOpen(scope: string, open: boolean, item?: string) {
  window.dispatchEvent(new CustomEvent(ALL, { detail: { scope, open, item } }));
}

/** "Expand all · Collapse all" for every card in `scope`. */
export function CollapseAll({ scope, className = "" }: { scope: string; className?: string }) {
  const all = (open: boolean) => setCardsOpen(scope, open);
  const cls = "rounded px-1.5 py-0.5 font-medium text-fg-muted hover:bg-muted hover:text-fg";
  return (
    <div className={`flex shrink-0 items-center gap-1 text-xs ${className}`}>
      <button type="button" onClick={() => all(true)} className={cls}>
        Expand all
      </button>
      <span className="text-gray-300" aria-hidden>·</span>
      <button type="button" onClick={() => all(false)} className={cls}>
        Collapse all
      </button>
    </div>
  );
}
