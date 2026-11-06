"use client";

// The editor (UI refactor, Nov 2026): the page's header and tabs, then one
// card with three columns that fills the window under them.
//
//   left    the tree, with a search box and the create controls
//   centre  a toolbar — the path, what the file is, Edit/Read, Save,
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
import { ArrowRight, ChevronRight, PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import { FileTree } from "./file-tree";
import { InlineEditor } from "./inline-editor";
import { ToolTest } from "./tool-test";
import { Page, Tag, Chip } from "./kit/page";
import { Button } from "./kit/button";
import { inputBase } from "./kit/input";
import { cn } from "./kit/cn";
import { fmtAgo } from "./overview-model";
import { useConfirm } from "./confirm";
import type { Chip as FileChip } from "./editor-context-model";

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
  header,
}: {
  /** Above the editor card: the page's title and its tabs. */
  header?: ReactNode;
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
  chips: FileChip[];
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
    t === "ok" ? "text-success" : t === "warn" ? "text-warning" : t === "error" ? "text-danger" : t === "muted" ? "text-fg-subtle" : "text-fg-secondary";

  const shown = crumbs.length > 4 ? crumbs.slice(-3) : crumbs;
  const folded = crumbs.length > 4 ? crumbs[crumbs.length - 4] : null;

  return (
    <Page width="full">
      {confirmDialog}
      {header}
      {/* One card: the tree on the left, the open file on the right, and what
          it relates to beside it on a wide screen. It fills the window under
          the header, and each column scrolls on its own. */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface md:h-[calc(100svh-17rem)] md:min-h-[30rem] md:flex-row">
        <aside
          onClickCapture={guard}
          className="flex shrink-0 flex-col border-line bg-sunken max-md:max-h-[40vh] max-md:border-b md:w-64 md:border-r"
        >
          <div className="shrink-0 p-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" aria-hidden />
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
                className={cn(inputBase, "h-8 pl-8 pr-8 text-[13px]")}
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-line bg-sunken px-1.5 font-mono text-[11px] leading-4 text-fg-muted">/</kbd>
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
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
              <p className="px-2 py-4 text-center text-xs text-fg-muted">No file matches “{filter}”.</p>
            )}
          </div>
          {treeFooter && <div className="shrink-0 border-t border-line px-3 py-2.5 text-xs leading-relaxed text-fg-muted">{treeFooter}</div>}
        </aside>

        {/* The open file: its path and what it is on the left of a toolbar,
            the editor's own controls (view switch, Save, History) on the
            right, through a portal. */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-line px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <nav className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[13px] text-fg-muted" aria-label="Path" title={crumbs.map((c) => c.label).join("/")}>
                  {folded && (
                    <span className="flex items-center gap-1">
                      {folded.href ? <Link href={folded.href} className="hover:text-fg">…</Link> : <span>…</span>}
                      <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                    </span>
                  )}
                  {shown.map((c, i) => (
                    <span key={`${c.label}-${i}`} className={cn("flex items-center gap-1", i === shown.length - 1 ? "min-w-0" : "shrink-0")}>
                      {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
                      {c.href ? (
                        <Link href={c.href} className="max-w-32 truncate hover:text-fg">{c.label}</Link>
                      ) : (
                        <span className="truncate font-medium text-fg">{c.label}</span>
                      )}
                    </span>
                  ))}
                </nav>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div ref={setToolbar} className="flex flex-wrap items-center gap-2" />
                {actions}
                {content !== null && lastChange && (
                  <Link href={lastChange.href} className="hidden text-xs text-fg-muted hover:text-fg xl:inline" title={lastChange.at}>
                    {lastChange.by} · {fmtAgo(now - Date.parse(lastChange.at))}
                  </Link>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowContext((v) => !v)}
                  className="max-lg:hidden"
                  aria-pressed={showContext}
                  aria-label={showContext ? "Hide the context panel" : "Show the context panel"}
                  title={showContext ? "Hide the context panel" : "Show the context panel"}
                >
                  {showContext ? <PanelRightClose /> : <PanelRightOpen />}
                </Button>
              </div>
            </div>
            {/* What the file says about itself, quietly, under the path. */}
            {(kindLabel || chips.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {kindLabel && <Tag>{kindLabel}</Tag>}
                {chips.map((c) => (
                  <span key={c.label} title={c.title} className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs text-fg-secondary">{c.label}</span>
                ))}
              </div>
            )}
          </header>
          {issues.length > 0 && (
            <div role="alert" className="shrink-0 space-y-0.5 border-b border-warning-line bg-warning-soft px-4 py-2 text-xs text-warning">
              {issues.map((i) => (
                <p key={`${i.where}:${i.message}`}>
                  <span className="font-mono font-medium">{i.where}</span> — {i.message}
                </p>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {viewer ? (
              <div className="pt-4">{viewer}</div>
            ) : content === null || !selected ? (
              <div className="py-10">{emptyEditor}</div>
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
        </section>

        {/* What the file relates to. */}
        {showContext && (sections.length > 0 || (test && workspace)) && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line max-lg:hidden">
            {sections.map((s) => (
              <div key={s.title} className="border-b border-line px-4 py-3.5 last:border-b-0">
                <p className="mb-2 text-[13px] font-medium text-fg">{s.title}</p>
                {s.items.length === 0 ? (
                  <p className="text-[13px] text-fg-muted">{s.empty ?? "None."}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {s.items.map((it, i) => (
                      <li key={`${it.label}-${i}`} className="flex items-baseline justify-between gap-2 text-[13px]">
                        {it.href ? (
                          <Link href={it.href} className={cn("min-w-0 truncate hover:underline", it.mono && "font-mono text-xs", toneClass(it.tone))}>{it.label}</Link>
                        ) : (
                          <span className={cn("min-w-0 truncate", it.mono && "font-mono text-xs", toneClass(it.tone))}>{it.label}</span>
                        )}
                        {it.meta && <span className={cn("shrink-0 text-xs", it.tone === "error" ? "text-danger" : it.tone === "warn" ? "text-warning" : it.tone === "ok" ? "text-success" : "text-fg-muted")}>{it.meta}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.more && (
                  <Link href={s.more.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
                    {s.more.label} <ArrowRight className="size-3" aria-hidden />
                  </Link>
                )}
              </div>
            ))}
            {test && workspace && (
              <div className="px-4 py-3.5">
                <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg">
                  Test {dirty && <Chip tone="warn">runs what is saved</Chip>}
                </p>
                <ToolTest workspace={workspace} tenant={tenant} tool={test.tool} transport={test.transport} scriptArgs={test.scriptArgs} stale={dirty} />
              </div>
            )}
          </aside>
        )}
      </div>
    </Page>
  );
}
