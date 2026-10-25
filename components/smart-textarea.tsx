"use client";

// A textarea that suggests what can go at the cursor.
//
// The rules live in lib/completions.ts; this is only presentation and
// keyboard handling. Every editor in the app uses it, so `[[` behaves the
// same everywhere and a field you learn in one file works in the next.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { completionsAt, type CompletionContext, type Vocabulary } from "@/lib/completions";

// Fixed by the textarea's own style below, so caret maths stays exact.
const LINE_HEIGHT = 20;
const CHAR_WIDTH = 7.2;
const PADDING = 12;

const EMPTY: Vocabulary = {
  docs: [],
  agents: [],
  flows: [],
  skills: [],
  tools: [],
  secrets: [],
  scripts: [],
  types: [],
};

export function SmartTextarea({
  workspace,
  tenant,
  path,
  value,
  onChange,
  onSave,
  rows,
  className = "",
  errorLine = null,
  onKeyDown,
  autoFocus = false,
  placeholder,
}: {
  /** Omit at account scope: there's no workspace to draw real names from,
   *  but fields, methods and types still suggest. */
  workspace?: string;
  tenant: string;
  /** The file being edited — decides which fields are offered. */
  path: string;
  value: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  rows?: number;
  className?: string;
  /** 1-based line to mark in the gutter — where a save error points. */
  errorLine?: number | null;
  /** Keys the caller wants, seen ONLY when no completion list is open —
   *  so an editor whose Enter means "save" cannot steal the Enter that
   *  accepts a suggestion. That precedence is why this is a prop rather
   *  than the caller wrapping the textarea itself. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** For an editor that opens in place: the box should already have the
   *  caret, or the click that opened it costs a second click. */
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [vocab, setVocab] = useState<Vocabulary>(EMPTY);
  const [ctx, setCtx] = useState<CompletionContext | null>(null);
  const [active, setActive] = useState(0);
  // Where the caret is, so the list appears next to what you're typing rather
  // than pinned to the top of the box.
  const [caret, setCaret] = useState({ top: 0, left: 0 });

  // One fetch per editor mount; the vocabulary changes far slower than typing.
  useEffect(() => {
    if (!workspace) return;
    fetch(`/api/workspaces/${workspace}/vocabulary`, { headers: { "x-foldrun-tenant": tenant } })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then(setVocab)
      .catch(() => setVocab(EMPTY));
  }, [workspace, tenant]);

  const refresh = (text: string, cursor: number) => {
    const next = completionsAt(path, text, cursor, vocab);
    setCtx(next && next.items.length ? next : null);
    setActive(0);
    if (!next) return;

    // A textarea gives no caret coordinates, so measure: the line index times
    // the line height, minus how far the box is scrolled. Exact because the
    // font and line-height are fixed below.
    const el = ref.current;
    if (!el) return;
    const before = text.slice(0, cursor);
    const line = before.split("\n").length - 1;
    const col = cursor - (before.lastIndexOf("\n") + 1);
    const top = (line + 1) * LINE_HEIGHT - el.scrollTop + PADDING;
    setCaret({
      // Keep the list inside the box, and never let it cover the caret line.
      top: Math.max(PADDING, Math.min(top, el.clientHeight - 40)),
      left: Math.min(col * CHAR_WIDTH, Math.max(0, el.clientWidth - 320)),
    });
  };

  const accept = (index: number) => {
    const el = ref.current;
    if (!el || !ctx) return;
    const item = ctx.items[index];
    if (!item) return;
    const insert = item.insert ?? item.label;
    const next = value.slice(0, ctx.from) + insert + value.slice(el.selectionStart);
    onChange(next);
    setCtx(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = ctx.from + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const lineCount = value.split("\n").length;
  // Wide enough for the highest line number, so the text does not shift left
  // as a file crosses 100 lines.
  const gutterWidth = Math.max(2, String(lineCount).length) * CHAR_WIDTH + 20;

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface shadow-sm focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-line">
      {/* A YAML error names a line — "bad indentation … at line 12" — which is
          unusable against a bare textarea. The gutter is what makes the message
          actionable, so it marks the offending line rather than only counting.

          Absolutely positioned, and that is load-bearing rather than
          stylistic. As a flex child it contributed its own intrinsic height —
          one div per line — so a file with more lines than the textarea has
          rows stretched the *container* to the gutter's height, and you got a
          column of line numbers running down an empty page beside a
          normal-sized box. Out of flow, the textarea alone decides how tall
          this is and the gutter simply scrolls with it. */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        style={{ lineHeight: `${LINE_HEIGHT}px`, width: `${gutterWidth}px` }}
        className="absolute inset-y-0 left-0 select-none overflow-hidden border-r border-line-faint bg-sunken/70 py-3 pr-2 text-right font-mono text-xs tabular-nums text-fg-subtle"
      >
        {Array.from({ length: lineCount }, (_, i) => i + 1).map((n) => (
          <div key={n} className={n === errorLine ? "font-semibold text-red-600" : undefined}>
            {n}
          </div>
        ))}
      </div>

      <div className="relative" style={{ marginLeft: `${gutterWidth}px` }}>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onScroll={(e) => {
          // The gutter has no scrollbar of its own; it follows.
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        value={value}
        rows={rows ?? Math.min(28, Math.max(10, value.split("\n").length + 2))}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => refresh(value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setCtx(null), 120)}
        onKeyDown={(e) => {
          if (ctx) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % ctx.items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + ctx.items.length) % ctx.items.length);
              return;
            }
            // Tab and Enter both accept. Enter alone would fight with writing
            // prose, so it only accepts while the list is open.
            if (e.key === "Tab" || e.key === "Enter") {
              e.preventDefault();
              accept(active);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setCtx(null);
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            onSave?.();
            return;
          }
          // Tab indents. Half the files here are programs, and a textarea
          // that moves focus on Tab cannot be used to write one — every
          // indent became a click back into the box. Shift+Tab is left to
          // the browser so keyboard users can still leave.
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + 2;
            });
            return;
          }
          onKeyDown?.(e);
        }}
        style={{ lineHeight: `${LINE_HEIGHT}px` }}
        className={`w-full resize-y border-0 bg-transparent p-3 font-mono text-xs text-fg focus:outline-none focus:ring-0 ${className}`}
      />

      {ctx && (
        <div
          style={{ top: caret.top, left: caret.left }}
          className="absolute z-20 max-h-64 w-80 overflow-auto rounded-lg border border-line bg-surface shadow-xl"
        >
          <p className="border-b border-line-faint px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            {ctx.title}
          </p>
          <ul>
            {ctx.items.map((item, i) => (
              <li key={item.label}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(i);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs ${
                    i === active ? "bg-muted" : "hover:bg-sunken"
                  }`}
                >
                  <span className="font-mono font-medium text-fg">{item.label}</span>
                  {item.hint && <span className="truncate text-fg-muted">{item.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-faint px-3 py-1 text-[10px] text-fg-subtle">
            ↑↓ to move · tab or enter to insert · esc to dismiss
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
