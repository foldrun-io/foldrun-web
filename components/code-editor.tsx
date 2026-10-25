"use client";

// A real code editor for the files that are programs.
//
// Half of what the editor opens is code — a tool's run.py, a helper module,
// a JSON state file — and a textarea gives it nothing: no highlighting, no
// bracket matching, no indent-on-enter. That is not a nicety for someone
// writing a tool; it is the difference between an editor and a form field.
//
// CodeMirror, for program files only. Markdown stays on SmartTextarea, which
// owns the [[ ]] and frontmatter completions and is the right tool for prose.
// Splitting by extension rather than replacing everything keeps the two
// completion systems from having to be merged, and keeps this bundle out of
// every page that never opens a program.

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

/** Which grammar a path gets. Unknown extensions still get the editor —
 *  line numbers and bracket matching are worth having for anything. */
function languageFor(path: string): LanguageSupport | ReturnType<typeof StreamLanguage.define> | null {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".py":
      return python();
    case ".js":
    case ".mjs":
    case ".cjs":
      return javascript();
    case ".ts":
      return javascript({ typescript: true });
    case ".json":
      return json();
    case ".yaml":
    case ".yml":
      return yaml();
    case ".sh":
    case ".bash":
      return StreamLanguage.define(shell);
    default:
      return null;
  }
}

/** Does this path want the code editor rather than the prose one? */
export const isCodePath = (path: string) => !path.endsWith(".md");

// Every colour is a palette variable, so the editor follows the dashboard's
// theme (globals.css) without being rebuilt when it changes.
const v = (name: string) => `var(--color-${name})`;
const theme = EditorView.theme({
  "&": {
    fontSize: "12.5px",
    color: v("gray-900"),
    backgroundColor: v("white"),
    border: `1px solid ${v("gray-200")}`,
    borderRadius: "0.5rem",
  },
  "&.cm-focused": { outline: "none", borderColor: v("gray-400") },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: v("gray-50"), color: v("gray-400"), border: "none" },
  ".cm-activeLineGutter": { backgroundColor: v("gray-100") },
  ".cm-activeLine": { backgroundColor: v("gray-50") },
  ".cm-content": { padding: "8px 0", caretColor: v("gray-900") },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: v("gray-900") },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: v("sky-100"),
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: v("emerald-100"), outline: "none" },
  ".cm-searchMatch": { backgroundColor: v("amber-100") },
  ".cm-panels": { backgroundColor: v("gray-50"), color: v("gray-900"), borderColor: v("gray-200") },
  ".cm-tooltip": { backgroundColor: v("white"), color: v("gray-900"), border: `1px solid ${v("gray-200")}` },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: v("gray-100"), color: v("gray-900") },
  ".cm-foldPlaceholder": { backgroundColor: v("gray-100"), color: v("gray-500"), border: "none" },
});

// The syntax colours, the same way. basicSetup's own style is only a
// fallback, so this one wins.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: v("violet-700") },
  { tag: [t.string, t.special(t.string), t.regexp], color: v("emerald-700") },
  { tag: [t.number, t.bool, t.null, t.atom], color: v("amber-700") },
  { tag: [t.comment, t.lineComment, t.blockComment], color: v("gray-400"), fontStyle: "italic" },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.function(t.propertyName)], color: v("blue-700") },
  { tag: [t.typeName, t.className, t.namespace], color: v("sky-700") },
  { tag: [t.propertyName, t.attributeName], color: v("red-700") },
  { tag: [t.meta, t.processingInstruction], color: v("gray-500") },
  { tag: t.invalid, color: v("red-600") },
]);

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  rows = 16,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  rows?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, read by extensions that were built once. Rebuilding
  // the editor on every render would lose the cursor and the undo history.
  const latest = useRef({ onChange, onSave });
  latest.current = { onChange, onSave };
  const language = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: "Mod-s",
            run: () => {
              latest.current.onSave?.();
              return true;
            },
          },
        ]),
        language.current.of(languageFor(path) ?? []),
        theme,
        syntaxHighlighting(highlight),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The document is seeded once; later `value` changes come from us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // A value that changed from outside — a reload, a reset — is pushed in
  // without disturbing an editor whose text already matches.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={host}
      style={{ minHeight: `${rows * 1.6 * 12.5 + 16}px` }}
      className="[&_.cm-editor]:min-h-[inherit]"
    />
  );
}
