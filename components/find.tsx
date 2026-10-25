"use client";

// Find: one box that reaches anything in the account. F or ⌘K opens it
// from any dashboard page; a few letters find a workspace, an agent, a
// flow, a tool, a knowledge file, a run by id or by what it concluded, or
// a page of the dashboard itself. Enter opens the highlighted row.
//
// The dashboard had a workspace switcher and nothing else: reaching an
// agent meant knowing its workspace, then its shelf, then scrolling. The
// palette is what turns a folder of markdown into something you can ask for
// by name. Results come from /api/search, ranked by find-model.ts; the
// page list is ranked here with the same rules, so the two never disagree.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { rank, groupHits, pagesFor, type FindHit, type FindKind } from "./find-model";
import { workspaceOf } from "./sidebar";

export const FIND_EVENT = "foldrun:find";
export function openFind() {
  window.dispatchEvent(new Event(FIND_EVENT));
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const KIND_DOT: Record<FindKind, string> = {
  workspace: "var(--color-blue-600)",
  agent: "var(--color-gray-900)",
  flow: "var(--color-emerald-600)",
  run: "var(--color-gray-400)",
  tool: "var(--color-amber-400)",
  hook: "var(--color-red-400)",
  skill: "var(--color-gray-400)",
  knowledge: "var(--color-blue-300)",
  memory: "var(--color-violet-300)",
  page: "var(--color-gray-300)",
};

const STATUS_DOT: Record<string, string> = {
  completed: "var(--color-emerald-500)",
  failed: "var(--color-red-500)",
  running: "var(--color-amber-500)",
  "awaiting-approval": "var(--color-amber-500)",
  queued: "var(--color-gray-400)",
  stopped: "var(--color-gray-400)",
};

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** The sidebar's box: looks like a search field, opens the palette. */
export function FindTrigger({ compact = false }: { compact?: boolean } = {}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openFind}
        title="Find (F)"
        aria-label="Find"
        className="mb-4 flex h-8 w-full items-center justify-center rounded-md border border-line bg-surface text-fg-subtle shadow-sm transition-colors hover:border-line-strong hover:text-fg-tertiary"
      >
        <SearchIcon />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openFind}
      className="mb-4 flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-sm text-fg-subtle shadow-sm transition-colors hover:border-line-strong hover:text-fg-tertiary"
    >
      <SearchIcon />
      <span className="flex-1">Find</span>
      <kbd className="rounded border border-line bg-sunken px-1.5 font-mono text-[10px] text-fg-muted">F</kbd>
    </button>
  );
}

export function Find() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const tenant = params.get("tenant") ?? "default";
  const qs = tenant !== "default" ? `tenant=${tenant}` : "";
  const workspace = workspaceOf(pathname);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<FindHit[]>([]);
  // The query the server last answered; while it trails `q`, we are looking.
  const [answered, setAnswered] = useState<string | null>(null);
  // The highlighted row, remembered with the query it belongs to, so a new
  // query starts at the top without an effect resetting anything.
  const [cursor, setCursor] = useState({ q: "", i: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const show = () => {
    setQ("");
    setCursor({ q: "", i: 0 });
    setAnswered(null);
    setOpen(true);
  };

  // A launcher, not a place: it closes when the page changes under it.
  // Adjusted during render, the React way, rather than in an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  // F when nothing else has the keys; ⌘K / Ctrl+K always; the custom event
  // from any trigger button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
        return;
      }
      if (open) return;
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(FIND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(FIND_EVENT, onOpen);
    };
  }, [open]);

  // Cursor in the box once it is on screen.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Ask the server, debounced; an answer that arrives after the query moved
  // on is aborted rather than shown.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const asked = q;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(asked)}`, { headers: { "x-foldrun-tenant": tenant }, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits?: FindHit[] }) => {
          setRemote(d.hits ?? []);
          setAnswered(asked);
        })
        .catch(() => {});
    }, asked ? 120 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, tenant]);

  const loading = answered !== q;
  const pages = rank(pagesFor(workspace, qs), q, q ? 5 : 8);
  const groups = groupHits([...remote, ...pages]);
  const flat = groups.flatMap((g) => g.hits);
  const active = Math.min(cursor.q === q ? cursor.i : 0, Math.max(0, flat.length - 1));
  const setActive = (i: number) => setCursor({ q, i });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (hit: FindHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href);
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[1px]" onPointerDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Find"
        onPointerDown={(e) => e.stopPropagation()}
        className="mx-auto mt-[10vh] w-[640px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line-faint px-3.5">
          <span className="text-fg-subtle"><SearchIcon size={16} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(flat.length - 1, active + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(0, active - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(flat[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={workspace ? `Find in ${workspace} or anywhere…` : "Find a workspace, agent, flow, run, tool, page…"}
            aria-label="Find"
            className="h-12 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-auto py-1.5">
          {flat.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-fg-subtle">
              {loading ? "Looking…" : `Nothing matches “${q}”.`}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.kind} className="px-1.5 pb-1">
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{g.label}</p>
              {g.hits.map((h) => {
                const i = flat.indexOf(h);
                const on = i === active;
                return (
                  <button
                    key={`${h.kind}:${h.href}:${h.title}`}
                    type="button"
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${on ? "bg-muted" : "hover:bg-sunken"}`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: h.kind === "run" ? (STATUS_DOT[h.status ?? ""] ?? KIND_DOT.run) : KIND_DOT[h.kind] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-sm ${h.kind === "run" ? "font-mono text-xs" : "font-medium"} text-fg`}>{h.title}</span>
                        {h.workspace && (
                          <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-fg-muted">{h.workspace}</span>
                        )}
                      </span>
                      {h.subtitle && <span className="block truncate text-xs text-fg-muted">{h.subtitle}</span>}
                    </span>
                    {on && <kbd className="shrink-0 font-mono text-[10px] text-fg-subtle">↵</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line-faint px-3.5 py-2 text-[11px] text-fg-subtle">
          <span><kbd className="font-mono">↑↓</kbd> move</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
          <span className="ml-auto"><kbd className="font-mono">F</kbd> or <kbd className="font-mono">⌘K</kbd> from anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
