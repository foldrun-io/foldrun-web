"use client";

// Expand-in-place editor for one markdown file.
//
// The assets list has always opened rows inline; agents and flows sent you to
// a separate editor page instead. Same file, same edit — so it's the same
// interaction here. Loads lazily, saves with ⌘S, and tells the page to
// re-render afterwards so derived views (badges, step lists, the graph) catch
// up with what you just wrote.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Badge, buttonClass } from "@/components/ui";
import { useCan } from "@/components/role";
import { SmartTextarea } from "@/components/smart-textarea";
import { CodeEditor, isCodePath } from "@/components/code-editor";
import { HistoryPanel } from "@/components/history-panel";
import { Markdown, Frontmatter } from "@/components/markdown";

// A YAML parse error names where it failed — "bad indentation of a sequence
// entry at line 12, column 14". Pulling the number out is what connects the
// message to the gutter; without it the reader counts lines by hand.
const errorLineOf = (message: string | null): number | null => {
  const m = message?.match(/\bline (\d+)/);
  return m ? Number(m[1]) : null;
};

export function InlineEditor({
  workspace,
  tenant,
  path,
  libraryKind,
  initialContent,
  rows,
  onSaved,
  onDirtyChange,
  hideSibling = false,
  toolbarTarget = null,
}: {
  /** Where the view switch, Save and status render when a host has a header
   *  for them — the editor shell. Null keeps them on the editor itself. */
  toolbarTarget?: HTMLElement | null;
  /**
   * The workspace this file belongs to. Omitted at account scope, matching
   * SmartTextarea and FrontmatterForm: there is no workspace to draw agent,
   * script or secret names from, so completion is skipped rather than guessed.
   */
  workspace?: string;
  tenant: string;
  path: string;
  /** Set for an account-library file — it reads and writes a different store. */
  libraryKind?: string;
  /**
   * The file's text, when the server already has it.
   *
   * A row that expands in place cannot know its content in advance, so the
   * default is to fetch on open. A dedicated edit page *does* know — it read
   * the file to render — and re-fetching it over HTTP would trade a rendered
   * page for a loading flicker. Supplying it here skips the round trip.
   */
  initialContent?: string;
  /** Taller on a page of its own than in a list row. */
  rows?: number;
  onSaved?: () => void;
  /** Fires as the unsaved state changes, so a host can say "the Test button
   *  runs what is on disk, and that is not what you are looking at". */
  onDirtyChange?: (dirty: boolean) => void;
  /** The host already shows the tool's files as tabs, so the "program this
   *  tool runs" line would be a second way to the same place. */
  hideSibling?: boolean;
}) {
  const mayWrite = useCan("workspace:write");
  const router = useRouter();
  const [content, setContent] = useState<string | null>(initialContent ?? null);
  const [saved, setSaved] = useState<string | null>(initialContent ?? null);
  // Which file `content`/`saved` currently hold. A folder tool switches files
  // by changing `path` on this same editor (the host no longer remounts it),
  // so until the new file has loaded, `content` still holds the previous one —
  // and this is how the view knows not to show it as if it were the new file.
  const [loadedPath, setLoadedPath] = useState(path);
  // Text we have already loaded, keyed by path. A tab opened before comes back
  // instantly — no refetch, no loading box, nothing below it reflows. The save
  // path keeps it fresh.
  const cache = useRef<Map<string, string>>(new Map());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A save the deploy's checks refused (FOL-57): saving anyway is one click,
  // never the default — the file goes live the moment it is saved.
  // Keyed to the exact path and text that was refused: switching file or
  // editing it again means a fresh, checked save (Codex review).
  const [refused, setRefused] = useState<string | null>(null);
  // Past versions of this file. Workspace files only for now: the library
  // records history too, but its panel needs a route of its own.
  const [showHistory, setShowHistory] = useState(false);

  // Tools are structured config, not prose — fields beat both raw text and a
  // rendered preview, because there is nothing to render but a key/value block.
  // Markdown renumbers ordered lists, so a flow's `1. 1. 2.` would render as
  // `1. 2. 3.` — silently destroying the parallel groups the numbers encode.
  const isFlow = path.startsWith("flows/");

  // One file, two ways to look at it: the text you edit, and a reading view
  // of the same bytes. Tools included — they used to open into a generated
  // key/value form instead, which meant the one kind of document people were
  // most wary of was also the one that didn't behave like a document. A tool
  // is markdown; it opens as markdown, edits as markdown, and its Read view
  // renders the frontmatter and the code block like any other file's.
  const [showAlt, setShowAlt] = useState(false);

  // Which view you last chose, remembered across files and visits.
  //
  // The toggle used to sit under the textarea, which on a long file is a
  // screen or two below the fold — so for anyone who does not read markdown
  // or YAML the reading view may as well not have existed. It is now a
  // control at the top, and the choice sticks: someone who works in Read
  // should not have to rediscover it on every file they open.
  const isTool = /(^|\/)tools\//.test(path) || libraryKind === "tools";
  useEffect(() => {
    // The remembered Read preference is for prose someone chose to *read*.
    // A tool is opened to be worked on: restoring "read" onto it made the
    // kind people edit most open in the one mode where nothing can change.
    if (isTool) return;
    try {
      setShowAlt(window.localStorage.getItem("foldrun.editor.view") === "read");
    } catch {
      // a browser with site data blocked still gets the toggle, just not the memory
    }
  }, [isTool]);

  const chooseView = (next: boolean) => {
    setShowAlt(next);
    // A tool's toggle is per-visit: choosing Read on one tool must not flip
    // every document on the account into Read.
    if (isTool) return;
    try {
      window.localStorage.setItem("foldrun.editor.view", next ? "read" : "edit");
    } catch {
      // as above
    }
  };
  const dirty = content !== null && content !== saved;
  const hasInitial = initialContent !== undefined;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // A tab closed or reloaded with edits in it asks first. Soft navigations
  // inside the app are the host's to guard (the shell does), since Next's
  // router never fires this.
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  // A script tool is two files — the definition and the program it runs — and
  // the editor opens one of them. Without a way across, the half you actually
  // write was reachable only by leaving for the file tree and finding it by
  // hand: the "new tool" flow dropped you on a manifest with no visible route
  // to its code.
  //
  // The link comes from the definition itself (`run:`), not from a directory
  // listing, so it is exactly the file this tool runs and it works the same
  // at workspace and account scope. A scope-qualified `run:` is a SHARED
  // script that other tools point at too — editing it from here would be
  // editing something that is not only this tool's, so no link is offered.
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const programName =
    isTool && /(^|\/)tool\.md$/.test(path) && content
      ? /^run:[ \t]*(\S+)[ \t]*$/m.exec(content)?.[1]
      : undefined;
  const sibling =
    programName && !/^(workspace|account|shared|library)\//.test(programName)
      ? { label: programName.replace(/^\.\//, ""), file: `${folder}/${programName.replace(/^\.\//, "")}` }
      : isTool && folder && !path.endsWith(".md")
        ? { label: "tool.md", file: `${folder}/tool.md` }
        : null;
  const siblingHref = sibling
    ? libraryKind
      ? `/dashboard/library/edit?kind=${libraryKind}&path=${encodeURIComponent(sibling.file)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`
      : `/dashboard/${workspace}/edit?path=${encodeURIComponent(sibling.file)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`
    : null;

  // One place decides which store a file lives in; everything below is scope-blind.
  const readUrl = libraryKind
    ? `/api/library/${libraryKind}?path=${encodeURIComponent(path)}`
    : `/api/workspaces/${workspace}/source?path=${encodeURIComponent(path)}`;
  const writeUrl = libraryKind ? `/api/library/${libraryKind}` : `/api/workspaces/${workspace}/source`;

  useEffect(() => {
    // Already supplied by the server — nothing to fetch. Declared inside the
    // effect rather than as a guard around it so the hook order never varies.
    if (hasInitial) return;
    let live = true;
    // A cache hit resolves in a microtask (no paint of a loading box); a miss
    // goes to the network. Both settle through the same .then, so every
    // setState here is async — the loading state is derived from loadedPath,
    // not set synchronously in the effect body.
    const cached = cache.current.get(path);
    const source =
      cached !== undefined
        ? Promise.resolve(cached)
        : fetch(readUrl, { headers: { "x-foldrun-tenant": tenant } })
            .then((r) => r.json())
            .then((d) => (d.content ?? "") as string);
    source
      .then((text) => {
        if (!live) return;
        cache.current.set(path, text);
        setContent(text);
        setSaved(text);
        setLoadedPath(path);
        setError(null);
      })
      .catch(() => live && setError("could not load this file"));
    return () => {
      live = false;
    };
  }, [readUrl, path, tenant, hasInitial]);

  const save = async (anyway = false) => {
    if (content === null) return;
    setStatus("saving…");
    setError(null);
    setRefused(null);
    const res = await fetch(writeUrl, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      // Checked unless the person said "save anyway" (FOL-57).
      body: JSON.stringify({ path, content, ...(anyway ? {} : { check: true }) }),
    });
    if (res.ok) {
      setSaved(content);
      cache.current.set(path, content); // keep the cache in step with disk
      setStatus("saved");
      setTimeout(() => setStatus(null), 1500);
      onSaved?.();
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { level: string }[] };
      setStatus(null);
      setError(data.error ?? `save failed (${res.status})`);
      setRefused(res.status === 422 && (data.issues ?? []).some((i) => i.level === "error") ? `${path}\n${content}` : null);
    }
  };

  if (content === null || loadedPath !== path) {
    // Hold the editor's height while it loads, so the panels below it (the
    // Test box on a tool) do not jump up and then back down on every switch.
    // `loadedPath !== path` is the just-switched, not-yet-loaded window — the
    // buffer still holds the previous file, which must not render as this one.
    return (
      <div className="mt-3 border-t border-line-faint pt-3">
        <div
          className="flex items-center justify-center rounded-lg border border-line bg-sunken/60 text-xs text-fg-subtle"
          style={{ minHeight: `${(rows ?? 16) * 1.6 * 12.5 + 16}px` }}
        >
          {error ?? "Loading…"}
        </div>
      </div>
    );
  }

  // The second view, or why this file hasn't got one. Computed here rather
  // than above so `content` is known to be loaded.
  const alt: { label: string; node: ReactNode } | { label: string; why: string } | null = isFlow
      ? {
          label: "Read",
          why:
            "the board above is this flow's rendered view — as markdown, the steps would be " +
            "renumbered and the parallel groups would disappear",
        }
      : path.endsWith(".md")
        ? {
            label: "Read",
            node: (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-gray-800">
                <Frontmatter raw={content} />
                <Markdown text={content.replace(/^---[\s\S]*?\n---\n?/, "")} />
              </div>
            ),
          }
        : null;
  const altNode = alt && "node" in alt ? alt.node : null;

  return (
    <div className={toolbarTarget ? "pt-3" : "mt-3 border-t border-line-faint pt-3"}>
      {siblingHref && sibling && !hideSibling && (
        <p className="mb-2 text-xs text-fg-muted">
          {sibling.label === "tool.md" ? "The definition for this program: " : "The program this tool runs: "}
          <a href={siblingHref} className="font-medium text-fg underline underline-offset-2 hover:text-black">
            {sibling.label}
          </a>
        </p>
      )}
      {/* The view switch, centred in a row of its own above the editor — it
          used to float in the editor's corner, over the first line of text.
          The reason Read is unavailable, or that it is not editable, sits
          beside it. In the shell the header carries all of this. */}
      {alt && !toolbarTarget && (
        <div className="mb-2 flex items-center justify-center gap-3">
          <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
            <button
              type="button"
              onClick={() => chooseView(false)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${!showAlt ? "bg-ink text-on-ink shadow-sm" : "text-fg-muted hover:text-fg"}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => altNode && chooseView(true)}
              disabled={!altNode}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${!altNode ? "cursor-not-allowed text-gray-300" : showAlt ? "bg-ink text-on-ink shadow-sm" : "text-fg-muted hover:text-fg"}`}
            >
              {alt.label}
            </button>
          </div>
          {((!altNode && "why" in alt) || (showAlt && altNode)) && (
            <span className="text-xs text-fg-subtle">{!altNode && "why" in alt ? alt.why : "Switch to Edit to make changes"}</span>
          )}
        </div>
      )}
      <div className="relative">
        {showAlt && altNode ? (
          altNode
        ) : isCodePath(path) ? (
          // A program gets a code editor: highlighting, bracket matching,
          // indent-aware Enter. Prose keeps the textarea that owns the [[ ]]
          // and frontmatter completions.
          <CodeEditor
            path={path}
            value={content}
            onChange={setContent}
            onSave={() => dirty && void save()}
            rows={rows}
          />
        ) : (
          <SmartTextarea
            errorLine={errorLineOf(error)}
            workspace={workspace}
            tenant={tenant}
            path={path}
            value={content}
            onChange={setContent}
            onSave={() => dirty && void save()}
            rows={rows}
          />
        )}
      </div>
      {(() => {
        const bar = (
          <div className={toolbarTarget ? "flex flex-wrap items-center gap-2" : "mt-2 flex flex-wrap items-center gap-2"}>
            {toolbarTarget && alt && (
              <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => chooseView(false)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${!showAlt ? "bg-ink text-on-ink shadow-sm" : "text-fg-muted hover:text-fg"}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => altNode && chooseView(true)}
                  disabled={!altNode}
                  title={!altNode && "why" in alt ? alt.why : undefined}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${!altNode ? "cursor-not-allowed text-gray-300" : showAlt ? "bg-ink text-on-ink shadow-sm" : "text-fg-muted hover:text-fg"}`}
                >
                  {alt.label}
                </button>
              </div>
            )}
            <button
              onClick={() => void save()}
              disabled={!dirty || !mayWrite}
              title={mayWrite ? "⌘S" : "Your role is viewer — saving needs editor or above"}
              className={buttonClass("primary", toolbarTarget ? "!px-3 !py-1 !text-xs" : "")}
            >
              Save
            </button>
            {dirty && <Badge variant="warning">unsaved</Badge>}
            {status && <Badge variant="success">{status}</Badge>}
            {error && <Badge variant="error">{error}</Badge>}
            {refused !== null && refused === `${path}\n${content}` && mayWrite && (
              <button
                type="button"
                onClick={() => void save(true)}
                className="text-xs font-medium text-red-700 underline hover:text-red-900"
                title="Save with the errors: the file goes live as it is, and runs that read it may fail"
              >
                Save anyway
              </button>
            )}
            {workspace && !libraryKind && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className={`text-xs font-medium ${showHistory ? "text-fg" : "text-fg-subtle hover:text-fg"}`}
                title="Every saved version of this file, with diffs"
              >
                History
              </button>
            )}
            {!toolbarTarget && <span className="ml-auto font-mono text-xs text-fg-subtle">{path}</span>}
          </div>
        );
        return toolbarTarget ? createPortal(bar, toolbarTarget) : bar;
      })()}
      {showHistory && workspace && !libraryKind && (
        <HistoryPanel
          workspace={workspace}
          tenant={tenant}
          path={path}
          onUse={(text) => {
            setContent(text);
            setStatus(null);
          }}
        />
      )}
      {/* ⌘S and the suggestions are invisible until someone tries them, so the
          hint is not decoration. Editing an account file additionally changes
          every workspace at once, and nothing else here says so — the path
          looks the same as a local one. */}
      {!toolbarTarget && (
      <p className="mt-1.5 text-xs text-fg-subtle">
        {isCodePath(path)
          ? "⌘S saves · Tab indents · Test runs what is saved"
          : "⌘S saves · suggestions appear as you type · frontmatter is validated on save"}
        {libraryKind && " · shared with every workspace"}
      </p>
      )}
    </div>
  );
}
