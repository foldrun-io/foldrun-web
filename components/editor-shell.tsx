"use client";

// The editor as a workbench: three panes, full height.
//
//   left    the tree, with a search box and the create controls
//   centre  a header — the path, the frontmatter as chips, Edit/Read, Save,
//           who last touched it — over an editor that scrolls on its own
//   right   what the file relates to: who uses it, the secrets it names,
//           its runs, its recent changes, a test box, the reference page
//
// The page reads the disk and hands this plain data; this arranges it. The
// editor keeps its own state (InlineEditor) and renders its controls into
// the header through a portal, so nothing about saving moved.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FileTree } from "./file-tree";
import { Workbench, Pane, Stage } from "./pane";
import { InlineEditor } from "./inline-editor";
import { ToolTest } from "./tool-test";
import { Badge } from "./ui";
import { fmtAgo } from "./overview-model";
import { useConfirm } from "./confirm";
import type { Chip } from "./editor-context-model";

export interface ContextItem {
  label: string;
  href?: string;
  meta?: string;
  tone?: "ok" | "warn" | "error" | "muted";
  mono?: boolean;
}

export interface ContextSection {
  title: string;
  items: ContextItem[];
  /** Shown when there are no items. */
  empty?: string;
  /** A link at the section's foot. */
  more?: { label: string; href: string };
}

export interface Issue {
  where: string;
  message: string;
}

export function EditorShell({
  tenant,
  workspace,
  libraryKind,
  files,
  selected,
  linkBase,
  linkSuffix,
  linkStyle = "path",
  rootName,
  content,
  crumbs,
  chips,
  kindLabel,
  issues,
  lastChange,
  sections,
  test,
  now,
  treeFooter,
  emptyEditor,
  viewer,
  treeReadOnly = false,
  actions,
}: {
  /** Render this instead of the editor — a preview, a pretty-printed record,
   *  a "not served" note. */
  viewer?: ReactNode;
  /** A tree that lists but never creates, even inside a workspace. */
  treeReadOnly?: boolean;
  /** Controls for the header's right side when there is no editor toolbar —
   *  download, delete. */
  actions?: ReactNode;
  tenant: string;
  workspace?: string;
  libraryKind?: string;
  files: string[];
  selected?: string;
  linkBase: string;
  linkSuffix: string;
  linkStyle?: "path" | "library";
  rootName: string;
  content: string | null;
  crumbs: { label: string; href?: string }[];
  chips: Chip[];
  kindLabel: string;
  issues: Issue[];
  lastChange: { by: string; at: string; href: string } | null;
  sections: ContextSection[];
  /** For a workspace tool: the test box's inputs. */
  test?: { tool: string; transport: "http" | "script" | "mcp" | null; scriptArgs: string[] } | null;
  now: number;
  treeFooter?: ReactNode;
  emptyEditor?: ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [showContext, setShowContext] = useState(true);
  const [confirm, confirmDialog] = useConfirm();

  // "/" finds a file; Escape clears the filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.getElementById("editor-tree-filter")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Leaving a dirty file through the tree asks first. The tree's links are
  // soft navigations, which beforeunload never sees.
  const guard = (e: React.MouseEvent) => {
    if (!dirty) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("href");
    void confirm({ title: "Leave without saving?", body: "This file has unsaved changes. They are lost if you leave.", confirmLabel: "Leave" }).then((ok) => {
      if (ok && href) router.push(href);
    });
  };

  const toneClass = (t?: ContextItem["tone"]) =>
    t === "ok" ? "text-emerald-600" : t === "warn" ? "text-amber-600" : t === "error" ? "text-red-600" : t === "muted" ? "text-fg-subtle" : "text-fg-secondary";

  return (
    <Workbench>
      {confirmDialog}
      <Pane
        side="left"
        onClickCapture={guard}
        head={
          <div className="p-2">
            <label className="relative block">
              <input
                id="editor-tree-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilter("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Find a file…"
                aria-label="Find a file"
                className="h-8 w-full rounded-md border border-line bg-surface px-2.5 pr-7 text-xs text-fg placeholder:text-fg-subtle focus:border-gray-400 focus:outline-none"
              />
              <kbd className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] text-fg-subtle">/</kbd>
            </label>
          </div>
        }
        foot={treeFooter ? <div className="px-3 py-2 text-[11px] leading-relaxed text-fg-subtle">{treeFooter}</div> : undefined}
      >
        <div className="px-1.5 py-1">
          <FileTree
            files={files}
            selected={selected}
            linkBase={linkBase}
            linkSuffix={linkSuffix}
            linkStyle={linkStyle}
            rootName={rootName}
            workspace={workspace}
            tenant={tenant}
            readOnly={treeReadOnly || !workspace}
            filter={filter}
          />
          {filter.trim() && files.filter((f) => f.toLowerCase().includes(filter.trim().toLowerCase())).length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-fg-subtle">No file matches “{filter}”.</p>
          )}
        </div>
      </Pane>

      {/* Editor */}
      <Stage
        head={
        <>
        <header className="border-b border-line px-4 py-2">
          {/* One row: the path on the left, the controls on the right. A deep
              path keeps its last three segments and folds the rest into an
              ellipsis that reveals them on hover. On a phone the controls
              wrap under the path rather than run off the screen. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap font-mono text-xs text-fg-muted" aria-label="Path" title={crumbs.map((c) => c.label).join("/")}>
              {(() => {
                const shown = crumbs.length > 4 ? crumbs.slice(-3) : crumbs;
                const folded = crumbs.length > 4 ? crumbs[crumbs.length - 4] : null;
                return (
                  <>
                    {folded && (
                      <span className="flex items-center gap-1">
                        {folded.href ? <Link href={folded.href} className="hover:text-fg">…</Link> : <span>…</span>}
                        <span className="text-gray-300">/</span>
                      </span>
                    )}
                    {shown.map((c, i) => (
                      <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <span className="text-gray-300">/</span>}
                        {c.href ? (
                          <Link href={c.href} className="hover:text-fg">{c.label}</Link>
                        ) : (
                          <span className="truncate font-semibold text-fg">{c.label}</span>
                        )}
                      </span>
                    ))}
                  </>
                );
              })()}
            </nav>
            <div className="flex shrink-0 items-center gap-3">
              <div ref={setToolbar} className="flex items-center gap-2" />
              {actions}
              {content !== null && lastChange && (
                <Link href={lastChange.href} className="hidden text-[11px] text-fg-subtle hover:text-fg-secondary xl:inline" title={lastChange.at}>
                  {lastChange.by} · {fmtAgo(now - Date.parse(lastChange.at))}
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                className="text-[11px] text-fg-subtle hover:text-fg-secondary max-lg:hidden"
                title={showContext ? "Hide the context panel" : "Show the context panel"}
              >
                {showContext ? "Hide panel" : "Show panel"}
              </button>
            </div>
          </div>
          {/* What the file is, quietly, under the path. */}
          {(kindLabel || chips.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-line px-1.5 text-[10px] uppercase tracking-wide text-fg-muted">{kindLabel}</span>
              {chips.map((c) => (
                <span key={c.label} title={c.title} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-fg-tertiary">{c.label}</span>
              ))}
            </div>
          )}
        </header>
        {issues.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
            {issues.map((i) => (
              <p key={`${i.where}:${i.message}`}>
                <span className="font-mono text-amber-700">{i.where}</span> — {i.message}
              </p>
            ))}
          </div>
        )}
        </>
        }
      >
        <div className="px-4 pb-6">
          {viewer ? (
            <div className="pt-3">{viewer}</div>
          ) : content === null || !selected ? (
            <div className="py-16">{emptyEditor}</div>
          ) : (
            <InlineEditor
              key={selected}
              workspace={workspace}
              libraryKind={libraryKind}
              tenant={tenant}
              path={selected}
              initialContent={content}
              rows={40}
              toolbarTarget={toolbar}
              onDirtyChange={setDirty}
              onSaved={() => router.refresh()}
            />
          )}
        </div>
      </Stage>

      {/* Context */}
      {showContext && (
        <Pane side="right" className="max-lg:hidden">
          {sections.map((s) => (
            <div key={s.title} className="border-b border-line px-4 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{s.title}</p>
              {s.items.length === 0 ? (
                <p className="text-xs text-fg-subtle">{s.empty ?? "None."}</p>
              ) : (
                <ul className="space-y-1">
                  {s.items.map((it, i) => (
                    <li key={`${it.label}-${i}`} className="flex items-baseline justify-between gap-2 text-xs">
                      {it.href ? (
                        <Link href={it.href} className={`min-w-0 truncate hover:underline ${it.mono ? "font-mono" : ""} ${toneClass(it.tone)}`}>{it.label}</Link>
                      ) : (
                        <span className={`min-w-0 truncate ${it.mono ? "font-mono" : ""} ${toneClass(it.tone)}`}>{it.label}</span>
                      )}
                      {it.meta && <span className={`shrink-0 text-[11px] ${it.tone === "error" ? "text-red-600" : it.tone === "warn" ? "text-amber-600" : it.tone === "ok" ? "text-emerald-600" : "text-fg-subtle"}`}>{it.meta}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {s.more && (
                <Link href={s.more.href} className="mt-1.5 inline-block text-[11px] font-medium text-fg-muted hover:text-fg">{s.more.label} →</Link>
              )}
            </div>
          ))}
          {test && workspace && (
            <div className="border-b border-line px-4 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Test</p>
              {dirty && <Badge variant="warning">runs what is saved</Badge>}
              <div className="mt-1.5">
                <ToolTest workspace={workspace} tenant={tenant} tool={test.tool} transport={test.transport} scriptArgs={test.scriptArgs} stale={dirty} />
              </div>
            </div>
          )}
        </Pane>
      )}
    </Workbench>
  );
}
