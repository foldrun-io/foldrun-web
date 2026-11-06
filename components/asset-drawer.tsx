"use client";

// The detail drawer for one tool, hook, skill, memory or knowledge file.
//
// A list row used to expand into the raw file — frontmatter and all — with a
// Save button under it: a developer's editor jammed into a list. Now the row
// is a link and the drawer opens beside the list (cloudhost/Vercel style):
//
//   Overview  what it is, its settings as a form built from the frontmatter
//             schema (or, for prose, a reading view with an Edit toggle)
//   Test      tools and hooks: the real call, as before
//   Source    the whole file (and a folder's other files) for power users
//   Used by   who uses it, where it is overridden
//
// The URL carries it (`?open=<path>&tab=<tab>`), so a drawer can be linked,
// and Back closes it. Opening is a history push the router hears without a
// server round trip, so the drawer is instant.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Brain,
  Check,
  FileCode,
  FileText,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Webhook,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/kit/dialog";
import { Button } from "@/components/kit/button";
import { IconBox, Tag } from "@/components/kit/page";
import { Input, Textarea, inputBase } from "@/components/kit/input";
import { Menu, MenuContent, MenuTrigger } from "@/components/kit/menu";
import { cn } from "@/components/kit/cn";
import { useCan, needs } from "@/components/role";
import { InlineEditor } from "@/components/inline-editor";
import { ToolTest } from "@/components/tool-test";
import { HookTest } from "@/components/hook-test";
import { Markdown } from "@/components/markdown";
import { useAssetActions, AssetMenuItems } from "@/app/dashboard/[workspace]/assets/asset-row";
import {
  KIND_LABEL,
  TRANSPORT_LABEL,
  asList,
  asMap,
  asText,
  fieldsFor,
  otherKeys,
  readFront,
  setBody,
  setField,
  splitDoc,
  toYaml,
  type AssetItem,
  type UiField,
  assetOpenId,
  editableInPlace,
} from "@/components/asset-fields";
import { dump } from "js-yaml";

const KIND_ICON: Record<string, LucideIcon> = { tools: Wrench, hooks: Webhook, skills: Sparkles, memory: Brain, knowledge: BookOpen, scripts: FileCode };

type TabId = "overview" | "test" | "source" | "usage";
const TAB_LABEL: Record<TabId, string> = { overview: "Overview", test: "Test", source: "Source", usage: "Used by" };

function tabsOf(item: AssetItem): TabId[] {
  if (item.kind === "scripts") return ["source", "usage"];
  if (item.kind === "tools" || item.kind === "hooks") return ["overview", "test", "source", "usage"];
  return ["overview", "source", "usage"];
}

/** Whether Test can run from here, or only explain where to test it. */
function testable(item: AssetItem, workspace: string): boolean {
  if (!workspace) return false;
  if (item.kind === "tools") return !item.overridden;
  const h = item.hook;
  return item.kind === "hooks" && Boolean(h && !h.error && !h.shadowed && h.on && h.sample);
}

const isProse = (item: AssetItem) => item.kind === "skills" || item.kind === "memory" || item.kind === "knowledge";

/** What closing asks first, set by the open drawer. */
type Guard = { mayClose: () => Promise<boolean>; asking: () => boolean; dirty: () => boolean };

/**
 * Wraps a list of asset rows and owns the drawer. Any link inside whose URL
 * names `open=` (the rows, the row menus) opens the drawer in place instead
 * of navigating; a modified click still opens a new tab with the drawer open.
 */
export function AssetBrowser({
  items,
  workspace,
  tenant,
  children,
}: {
  items: AssetItem[];
  /** Empty for the account library. */
  workspace: string;
  tenant: string;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const openPath = params.get("open");
  const item = openPath ? (items.find((i) => assetOpenId(i) === openPath) ?? null) : null;
  const tabs = item ? tabsOf(item) : [];
  const asked = params.get("tab") as TabId | null;
  const tab: TabId = asked && tabs.includes(asked) ? asked : (tabs[0] ?? "overview");
  // Whether this drawer was opened by a click here: then closing is Back, so
  // the history holds no drawer-less copy of the page. Opened from a link or
  // a reload, closing replaces the entry instead.
  const pushed = useRef(false);
  const guard = useRef<Guard | null>(null);

  const urlWith = (next: Record<string, string | null>) => {
    const u = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    return `${window.location.pathname}${s ? `?${s}` : ""}`;
  };
  const open = (path: string) => {
    window.history.pushState(null, "", urlWith({ open: path, tab: null }));
    pushed.current = true;
  };
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", urlWith({ open: null, tab: null }));
    }
  };
  const setTab = (t: TabId) => window.history.replaceState(null, "", urlWith({ tab: t === tabs[0] ? null : t }));

  // Browser Back closes the drawer by taking `open` out of the URL. With
  // unsaved edits that would drop them silently, so put the drawer's URL back
  // and ask first; only a "Discard" goes back for real.
  const lastUrl = useRef<string | null>(null);
  const skipPop = useRef(false);
  useEffect(() => {
    lastUrl.current = openPath ? `${window.location.pathname}${window.location.search}` : null;
  }, [openPath, asked]);
  useEffect(() => {
    const onPop = async () => {
      if (skipPop.current) {
        skipPop.current = false;
        return;
      }
      const was = lastUrl.current;
      if (!was) return;
      const wasOpen = new URLSearchParams(was.split("?")[1] ?? "").get("open");
      if (new URLSearchParams(window.location.search).get("open") === wasOpen) return;
      if (!guard.current?.dirty()) return;
      window.history.pushState(null, "", was);
      pushed.current = true;
      if (await guard.current.mayClose()) {
        skipPop.current = true;
        pushed.current = false;
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const requestClose = async () => {
    if (guard.current && !(await guard.current.mayClose())) return;
    close();
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const url = new URL(a.href, window.location.href);
    const path = url.searchParams.get("open");
    if (!path || url.pathname !== window.location.pathname) return;
    e.preventDefault();
    open(path);
  };

  return (
    <div onClickCapture={onClickCapture}>
      {children}
      {/* Deferred: asked from inside an Escape keydown, the confirm's own
          Escape listener would hear the same key and cancel at once. */}
      <Sheet open={Boolean(item)} onOpenChange={(o) => !o && setTimeout(() => void requestClose(), 0)}>
        {item && (
          <SheetContent
            side="right"
            aria-describedby={undefined}
            className="w-screen max-w-none max-sm:border-l-0 sm:w-[40rem] sm:max-w-[calc(100vw-3rem)]"
            onEscapeKeyDown={(e) => guard.current?.asking() && e.preventDefault()}
            // Focus the drawer itself, not its first button: a ring on Test
            // reads as "this was chosen for you".
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.target as HTMLElement | null)?.focus?.();
            }}
          >
            <AssetDetail
              key={item.path}
              item={item}
              workspace={workspace}
              tenant={tenant}
              tab={tab}
              tabs={tabs}
              setTab={setTab}
              guardRef={guard}
              onGone={close}
            />
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}

function AssetDetail({
  item,
  workspace,
  tenant,
  tab,
  tabs,
  setTab,
  guardRef,
  onGone,
}: {
  item: AssetItem;
  workspace: string;
  tenant: string;
  tab: TabId;
  tabs: TabId[];
  setTab: (t: TabId) => void;
  guardRef: React.RefObject<Guard | null>;
  onGone: () => void;
}) {
  const router = useRouter();
  const mayWrite = useCan("workspace:write");
  const actions = useAssetActions(item, { workspace, tenant });
  const asking = useRef(false);
  const ask = async (o: Parameters<typeof actions.confirm>[0]) => {
    asking.current = true;
    try {
      return await actions.confirm(o);
    } finally {
      asking.current = false;
    }
  };

  // One place decides which store a file lives in.
  const readUrl = item.account
    ? `/api/library/${item.kind}?path=${encodeURIComponent(item.path)}`
    : `/api/workspaces/${workspace}/source?path=${encodeURIComponent(item.path)}`;
  const writeUrl = item.account ? `/api/library/${item.kind}` : `/api/workspaces/${workspace}/source`;

  // The definition file, as the Overview form and the reading view edit it.
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped when Source saved, so Overview reads the file again.
  const [overviewVersion, setOverviewVersion] = useState(0);
  // Bumped when Overview saved or discarded, so a mounted Source editor
  // drops its cached copy and reads the file again.
  const [sourceVersion, setSourceVersion] = useState(0);
  // Bumped whenever `content` is replaced wholesale, so list and map
  // editors re-read their rows.
  const [formVersion, setFormVersion] = useState(0);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [visitedSource, setVisitedSource] = useState(tab === "source");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<{ kind: "saving" | "saved" } | { kind: "error"; text: string; refused: boolean } | null>(null);

  // Once opened, Source stays mounted (hidden) so its unsaved text survives
  // a look at another tab.
  if (tab === "source" && !visitedSource) setVisitedSource(true);

  useEffect(() => {
    if (item.kind === "scripts") return;
    let live = true;
    fetch(readUrl, { headers: { "x-foldrun-tenant": tenant } })
      .then(async (r) => {
        if (r.ok) return r.json();
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `could not load this file (${r.status})`);
      })
      .then((d: { content?: string }) => {
        if (!live) return;
        setContent(d.content ?? "");
        setSaved(d.content ?? "");
        setFormVersion((v) => v + 1);
        setLoadError(null);
      })
      .catch((err: Error) => live && setLoadError(err.message));
    return () => {
      live = false;
    };
  }, [readUrl, tenant, item.kind, overviewVersion]);

  const dirty = content !== null && content !== saved;
  const edit = (next: string) => {
    setContent(next);
    if (state?.kind !== "saving") setState(null);
  };

  const save = async (anyway = false) => {
    if (content === null) return;
    setState({ kind: "saving" });
    const res = await fetch(writeUrl, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      // Checked unless the person said "save anyway" (FOL-57).
      body: JSON.stringify({ path: item.path, content, ...(anyway ? {} : { check: true }) }),
    });
    if (res.ok) {
      setSaved(content);
      setState({ kind: "saved" });
      setSourceVersion((v) => v + 1);
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { level: string }[] };
      setState({
        kind: "error",
        text: data.error ?? `Save failed (${res.status})`,
        refused: res.status === 422 && (data.issues ?? []).some((i) => i.level === "error"),
      });
    }
  };
  const discard = () => {
    setContent(saved);
    setState(null);
    setFormVersion((v) => v + 1);
  };

  // ⌘S saves the form too, as it does in Source.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && tab === "overview" && dirty && mayWrite) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A tab closed or reloaded with edits in it asks first.
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  useEffect(() => {
    guardRef.current = {
      asking: () => asking.current,
      dirty: () => dirty || sourceDirty,
      mayClose: async () =>
        !(dirty || sourceDirty) ||
        (await ask({ title: "Discard unsaved changes?", body: `Your edits to ${item.name} have not been saved.`, confirmLabel: "Discard" })),
    };
    return () => {
      guardRef.current = null;
    };
  });

  const Icon = KIND_ICON[item.kind] ?? FileText;
  const scope = item.account ? "Shared" : item.owner ? `Agent · ${item.owner}` : "Workspace";
  const kindLabel = item.kind === "tools" && item.transport ? `${KIND_LABEL.tools} · ${TRANSPORT_LABEL[item.transport]}` : KIND_LABEL[item.kind];
  const prose = isProse(item);
  const showFooter = tab === "overview" && item.kind !== "scripts" && !loadError && (!prose || editing || dirty);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {actions.confirmDialog}
      <header className="border-b border-line px-5 pt-5 sm:px-6">
        <div className="flex items-start gap-3 pr-8">
          <IconBox>
            <Icon />
          </IconBox>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-lg">{item.name}</SheetTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Tag>{kindLabel}</Tag>
              <Tag>{scope}</Tag>
              {/* A document's OKF type and state; a tool's is in its kind. */}
              {(item.kind === "memory" || item.kind === "knowledge") && item.badges}
            </div>
          </div>
        </div>
        <SheetDescription className="mt-3 line-clamp-2">{item.description || "No description yet."}</SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tabs.includes("test") && tab !== "test" && testable(item, workspace) && (
            <Button variant="secondary" size="sm" onClick={() => setTab("test")}>
              <Play /> Test
            </Button>
          )}
          {prose && tab === "overview" && (
            <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? <BookOpen /> : <Pencil />} {editing ? "Read" : "Edit"}
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${item.name}`}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              <AssetMenuItems actions={actions} onDone={onGone} />
            </MenuContent>
          </Menu>
          {actions.status && (
            <span role="status" className={cn("text-xs font-medium", actions.status.failed ? "text-danger" : "text-fg-muted")}>
              {actions.status.text}
            </span>
          )}
        </div>
        <nav role="tablist" aria-label="Sections" className="-mx-2 mt-3 flex gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex h-10 shrink-0 items-center rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                t === tab ? "text-fg" : "text-fg-muted hover:text-fg",
                "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                t === tab ? "after:bg-fg" : "after:bg-transparent",
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {tab === "overview" &&
          (loadError ? (
            item.kind === "hooks" ? <HookFacts item={item} why={loadError} /> : <Note tone="warn">{loadError}</Note>
          ) : content === null ? (
            <OverviewSkeleton />
          ) : (
            <>
              {sourceDirty && (
                <Note tone="warn">Source has unsaved changes. Save or discard them there before changing settings here.</Note>
              )}
              {item.notice && <div className="mb-4">{item.notice}</div>}
              {prose && !editing ? (
                <ReadingView item={item} content={content} />
              ) : (
                <fieldset disabled={sourceDirty || !mayWrite} className="min-w-0 space-y-6 disabled:opacity-70">
                  <SettingsForm key={formVersion} item={item} content={content} onChange={edit} workspace={workspace} tenant={tenant} />
                  {item.kind !== "hooks" && (
                    <BodyField key={`b${formVersion}`} item={item} content={content} onChange={edit} />
                  )}
                </fieldset>
              )}
            </>
          ))}

        {tab === "test" && <TestPane item={item} workspace={workspace} tenant={tenant} stale={dirty || sourceDirty} />}

        {tab === "source" && dirty && (
          <Note tone="warn" action={
            <span className="flex gap-2">
              <Button size="xs" variant="secondary" onClick={discard}>Discard</Button>
              <Button size="xs" variant="primary" onClick={() => void save()} disabled={!mayWrite}>Save</Button>
            </span>
          }>
            Overview has unsaved changes. Save or discard them before editing the file.
          </Note>
        )}
        {tab === "source" && loadError && item.kind === "hooks" && <HookFacts item={item} why={loadError} brief />}
        {visitedSource && !(loadError && item.kind === "hooks") && (
          <div hidden={tab !== "source" || dirty}>
            <SourcePane
              key={sourceVersion}
              item={item}
              workspace={workspace}
              tenant={tenant}
              onDirtyChange={setSourceDirty}
              onSaved={() => setOverviewVersion((v) => v + 1)}
            />
          </div>
        )}

        {tab === "usage" && (item.usedBy ?? <p className="text-sm text-fg-muted">Nothing records who uses this.</p>)}
      </div>

      {showFooter && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken px-5 py-3 sm:px-6">
          <div className="min-w-0 flex-1 text-xs">
            {state?.kind === "error" ? (
              <span className="flex flex-wrap items-center gap-2 text-danger">
                <X className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{state.text}</span>
                {state.refused && mayWrite && (
                  <button
                    type="button"
                    onClick={() => void save(true)}
                    className="font-medium underline underline-offset-2 hover:opacity-80"
                    title="Save with the errors: the file goes live as it is, and runs that read it may fail"
                  >
                    Save anyway
                  </button>
                )}
              </span>
            ) : state?.kind === "saved" && !dirty ? (
              <span className="flex items-center gap-1.5 text-success">
                <Check className="size-3.5" aria-hidden /> Saved
              </span>
            ) : dirty ? (
              <span className="text-fg-muted">Unsaved changes{item.account ? " · shared with every workspace" : ""}</span>
            ) : (
              <span className="text-fg-subtle">{mayWrite ? (item.account ? "Changes here reach every workspace." : "⌘S saves.") : needs("workspace:write")}</span>
            )}
          </div>
          {dirty && (
            <Button variant="ghost" size="sm" onClick={discard}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || !mayWrite || state?.kind === "saving"}
            title={mayWrite ? "⌘S" : needs("workspace:write")}
          >
            {state?.kind === "saving" ? "Saving…" : "Save"}
          </Button>
        </footer>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-9 animate-pulse rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}

function Note({ tone, children, action }: { tone: "warn" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-[13px]",
        tone === "warn" ? "border-warning-line bg-warning-soft text-warning" : "border-line bg-sunken text-fg-secondary",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** A hook's settings when its file cannot be opened here — the web's
 *  source API does not read or write hooks/ (core assertEditablePath). */
function HookFacts({ item, why, brief = false }: { item: AssetItem; why: string; brief?: boolean }) {
  const h = item.hook;
  const rows: [string, ReactNode][] = [
    ["Runs on", h?.on ? <span className="font-mono">{h.on}</span> : "—"],
    ...(h?.tool ? [["Only for tool", <span key="t" className="font-mono">{h.tool}</span>] as [string, ReactNode]] : []),
    ["Timeout", h?.timeoutSec ? `${h.timeoutSec}s` : "default"],
    ["Files", <span key="f" className="font-mono">{(item.files ?? [item.path]).join(", ")}</span>],
  ];
  return (
    <div className="space-y-4">
      {!brief && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-lg border border-line bg-sunken px-4 py-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <Note tone="info">
        A hook is your code, so it is changed in its folder — edit <span className="font-mono">hook.md</span> and{" "}
        <span className="font-mono">run.mjs</span> and deploy, or use <span className="font-mono">foldrun hook</span>. The dashboard reads it
        but does not write it ({why}).
      </Note>
    </div>
  );
}

// ---- Overview: the form ----------------------------------------------------

function SettingsForm({
  item,
  content,
  onChange,
  workspace,
  tenant,
}: {
  item: AssetItem;
  content: string;
  onChange: (next: string) => void;
  workspace: string;
  tenant: string;
}) {
  const { data, error } = useMemo(() => readFront(content), [content]);
  const fields = useMemo(() => fieldsFor(item.kind, data), [item.kind, data]);
  const others = otherKeys(item.kind, data, fields);
  const vocab = useVocabulary(workspace, tenant, item.kind === "tools");
  // Which optional fields sit up top is decided once, from the file as it
  // was opened: typing a first character into a "More settings" field (or
  // clearing one up top) must not move the control mid-entry and drop focus.
  const [setAtOpen] = useState(() => new Set(Object.keys(readFront(content).data ?? {})));
  const [safeAtOpen] = useState(() => editableInPlace(content));

  if (error) {
    return (
      <Note tone="warn">
        The settings at the top of this file do not read as YAML ({error}). Fix them in Source.
      </Note>
    );
  }

  // Checked against the file as opened: the form's own writes are block
  // style, so an edit in progress never turns this off by itself.
  if (!safeAtOpen) {
    return (
      <div className="space-y-4">
        <Note tone="warn">
          This file&apos;s settings are written in a YAML style the form can&apos;t change without rewriting them. They are shown here; edit them in Source.
        </Note>
        <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 px-4 py-2.5 text-sm">
              <dt className="font-mono text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words font-mono text-fg">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const set = (key: string, value: unknown) => onChange(setField(content, key, value));
  const shown = fields.filter((f) => f.primary || setAtOpen.has(f.key));
  const more = fields.filter((f) => !shown.includes(f));

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        {shown.map((f) => (
          <FieldRow key={f.key} field={f} value={data[f.key]} onChange={(v) => set(f.key, v)} vocab={vocab} />
        ))}
      </div>
      {more.length > 0 && (
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            More settings
            <span className="text-xs font-normal text-fg-muted">
              {more.length} optional · <span className="group-open:hidden">show</span>
              <span className="hidden group-open:inline">hide</span>
            </span>
          </summary>
          <div className="space-y-5 border-t border-line px-4 py-4">
            {more.map((f) => (
              <FieldRow key={f.key} field={f} value={data[f.key]} onChange={(v) => set(f.key, v)} vocab={vocab} />
            ))}
          </div>
        </details>
      )}
      {others.length > 0 && (
        <p className="text-xs text-fg-muted">
          Also in this file, edited in Source: <span className="font-mono">{others.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

type Vocab = { scripts: string[]; secrets: string[] };

/** Real script and secret names to offer — a path typed by hand is the
 *  commonest way to make a tool that silently never loads. */
function useVocabulary(workspace: string, tenant: string, wanted: boolean): Vocab {
  const [vocab, setVocab] = useState<Vocab>({ scripts: [], secrets: [] });
  useEffect(() => {
    if (!workspace || !wanted) return;
    fetch(`/api/workspaces/${workspace}/vocabulary`, { headers: { "x-foldrun-tenant": tenant } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v && setVocab({ scripts: v.scripts ?? [], secrets: v.secrets ?? [] }))
      .catch(() => {});
  }, [workspace, tenant, wanted]);
  return vocab;
}

const SUGGEST: Record<string, string[]> = {
  interpreters: ["python3", "node", "bash", "ruby"],
  mcp: ["npx", "uvx", "docker"],
};

function FieldRow({ field, value, onChange, vocab }: { field: UiField; value: unknown; onChange: (v: unknown) => void; vocab: Vocab }) {
  const id = `f-${field.key}`;
  const suggestions = field.suggest === "scripts" ? vocab.scripts : field.suggest === "secrets" ? vocab.secrets : field.suggest ? SUGGEST[field.suggest] : undefined;
  const listId = suggestions?.length ? `${id}-options` : undefined;
  const control = (() => {
    switch (field.control) {
      case "select":
        return (
          <select id={id} value={asText(value)} onChange={(e) => onChange(e.target.value || undefined)} className={cn(inputBase, "h-9 py-1.5")}>
            <option value="">Not set</option>
            {/* A value outside the known set still shows, so saving never drops it. */}
            {value !== undefined && !field.options?.some((o) => o.value === asText(value)) && <option value={asText(value)}>{asText(value)}</option>}
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "boolean":
        return (
          <select id={id} value={value === true ? "true" : value === false ? "false" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")} className={cn(inputBase, "h-9 py-1.5")}>
            <option value="">Not set</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      case "number":
        return <Input id={id} type="number" value={asText(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="max-w-40" />;
      case "textarea":
        return <Textarea id={id} rows={2} value={asText(value)} onChange={(e) => onChange(e.target.value)} className="min-h-0" />;
      case "list":
        return <ListEditor id={id} values={asList(value)} onChange={(v) => onChange(v)} placeholder={field.placeholder} listId={listId} />;
      case "map":
        return <MapEditor id={id} entries={asMap(value)} onChange={(v) => onChange(v)} />;
      case "complex":
        return (
          <pre className="max-h-48 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">
            {value === undefined ? "Not set" : dump(value, { lineWidth: -1 }).trimEnd()}
          </pre>
        );
      default:
        return (
          <Input
            id={id}
            value={asText(value)}
            list={listId}
            placeholder={field.placeholder}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value;
              onChange(field.numeric && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v);
            }}
            className={cn(["base", "url", "run", "command", "openapi"].includes(field.key) && "font-mono text-[13px]")}
          />
        );
    }
  })();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-fg">
        {field.label}
        <span className="font-mono text-xs font-normal text-fg-subtle">{field.key}</span>
      </label>
      {control}
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <p className="text-xs text-fg-muted">
        {field.help.charAt(0).toUpperCase() + field.help.slice(1)}
        {field.control === "complex" && " — edited in Source."}
      </p>
    </div>
  );
}

/** Rows of one value each. Local rows, so an empty row being typed into is
 *  never written to the file as an empty item. */
function ListEditor({ id, values, onChange, placeholder, listId }: { id: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; listId?: string }) {
  const [rows, setRows] = useState<string[]>(values.length ? values : []);
  const emit = (next: string[]) => {
    setRows(next);
    onChange(next.map((s) => s.trim()).filter(Boolean));
  };
  return (
    <div className="space-y-2">
      {rows.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            id={i === 0 ? id : undefined}
            value={v}
            list={listId}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? e.target.value : r)))}
            className="font-mono text-[13px]"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => emit(rows.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="xs" onClick={() => setRows([...rows, ""])} id={rows.length ? undefined : id}>
        <Plus /> Add
      </Button>
    </div>
  );
}

/** Name → value rows, for flat maps (headers, env, a script's arguments). */
function MapEditor({ id, entries, onChange }: { id: string; entries: [string, string][]; onChange: (v: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>(entries);
  const emit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            id={i === 0 ? id : undefined}
            value={k}
            placeholder="name"
            aria-label="Name"
            spellCheck={false}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            className="font-mono text-[13px]"
          />
          <Input
            value={v}
            placeholder="value"
            aria-label={`Value of ${k || "this row"}`}
            spellCheck={false}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => emit(rows.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="xs" onClick={() => setRows([...rows, ["", ""]])} id={rows.length ? undefined : id}>
        <Plus /> Add
      </Button>
    </div>
  );
}

/** The prose under the settings: a tool's guide, a skill's or a document's text. */
function BodyField({ item, content, onChange }: { item: AssetItem; content: string; onChange: (next: string) => void }) {
  const { body } = splitDoc(content);
  // The blank line after the frontmatter is the file's, not the text's.
  const lead = body.startsWith("\n") ? "\n" : "";
  const label = item.kind === "tools" ? "Guide" : item.kind === "skills" ? "Instructions" : "Text";
  const help =
    item.kind === "tools"
      ? "What the agent reads about this tool, in markdown."
      : item.kind === "skills"
        ? "The procedure an agent follows when it loads this skill, in markdown."
        : "What agents read, in markdown.";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="f-body" className="text-sm font-medium text-fg">
        {label}
      </label>
      <Textarea
        id="f-body"
        value={body.slice(lead.length)}
        onChange={(e) => onChange(setBody(content, lead + e.target.value))}
        rows={item.kind === "tools" ? 8 : 18}
        spellCheck
        className="font-mono text-[13px] leading-relaxed"
      />
      <p className="text-xs text-fg-muted">{help}</p>
    </div>
  );
}

// ---- Overview: reading prose ----------------------------------------------

function ReadingView({ item, content }: { item: AssetItem; content: string }) {
  const { data } = readFront(content);
  const { body } = splitDoc(content);
  const facts: [string, ReactNode][] = [];
  const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "object" ? toYaml(v) : String(v));
  if (item.kind === "skills") {
    if (str(data.when)) facts.push(["Loads on", asList(data.when).join(", ")]);
    if (str(data["allowed-tools"])) facts.push(["Allowed tools", asList(data["allowed-tools"]).join(", ")]);
  } else {
    if (str(data.type) && !item.badges) facts.push(["Type", str(data.type)]);
    facts.push(["Status", str(data.status) ?? "stable"]);
    if (asList(data.tags).length) facts.push(["Tags", <span key="t" className="flex flex-wrap gap-1">{asList(data.tags).map((t) => <Tag key={t}>{t}</Tag>)}</span>]);
    if (str(data.stale_after)) facts.push(["Stale after", str(data.stale_after)]);
  }
  return (
    <div className="space-y-5">
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-lg border border-line bg-sunken px-4 py-3 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {body.trim() ? (
        <article className="text-[15px] leading-relaxed text-fg-secondary">
          <Markdown text={body} />
        </article>
      ) : (
        <p className="text-sm text-fg-muted">Nothing written yet. Choose Edit to add the text.</p>
      )}
    </div>
  );
}

// ---- Test ------------------------------------------------------------------

function TestPane({ item, workspace, tenant, stale }: { item: AssetItem; workspace: string; tenant: string; stale: boolean }) {
  if (item.kind === "tools") {
    if (!workspace) {
      // A test runs from an agent's folder in a workspace — secrets, state
      // and paths all resolve there. The library has none of that.
      return <Note tone="info">Test it from a workspace that grants it — a run stands in that workspace, not here.</Note>;
    }
    if (item.overridden) {
      return <Note tone="info">This workspace has its own {item.name}, which runs instead of the shared one. Test that one.</Note>;
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">Calls the tool for real — a request, a process or an MCP handshake — and shows what came back.</p>
        <ToolTest workspace={workspace} tenant={tenant} tool={item.name} transport={item.transport ?? null} scriptArgs={item.scriptArgs ?? []} stale={stale} />
      </div>
    );
  }
  const h = item.hook;
  if (!workspace) return <Note tone="info">Test it from a workspace that turns it on — a hook runs inside a workspace&apos;s steps.</Note>;
  if (!h) return <Note tone="info">Nothing to test yet.</Note>;
  if (h.error) return <Note tone="warn">{h.error}</Note>;
  if (h.shadowed) return <Note tone="info">A workspace hook with the same name runs instead of this one. Test that one.</Note>;
  if (!h.on || !h.sample) return <Note tone="info">Say which event it runs on (Overview → Runs on) to test it.</Note>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        Hands the hook a sample <span className="font-mono">{h.on}</span> event and shows what a step would hear back.
        {stale && <span className="text-warning"> Save first — the test runs what is on disk.</span>}
      </p>
      <HookTest workspace={workspace} tenant={tenant} hook={item.name} sample={h.sample} initiallyOpen />
    </div>
  );
}

// ---- Source ----------------------------------------------------------------

function SourcePane({
  item,
  workspace,
  tenant,
  onDirtyChange,
  onSaved,
}: {
  item: AssetItem;
  workspace: string;
  tenant: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { files, path, account, kind } = item;
  // Which file of a folder tool is being edited — the definition first,
  // because that is what the tool *is*.
  const [editing, setEditing] = useState<string | null>(null);
  // "+ Add file" inside a folder: a helper module, a requirements file.
  const [adding, setAdding] = useState(false);
  const [newFile, setNewFile] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const writeUrl = account ? `/api/library/${kind}` : `/api/workspaces/${workspace}/source`;

  // The folder it lives in, for adding to it: `tools/x/tool.md` → `tools/x`.
  const folder = files?.length ? path.slice(0, path.lastIndexOf("/")) : null;
  const addFile = async () => {
    const base = newFile.trim();
    if (!folder || !base) return;
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-z0-9]+$/.test(base)) {
      setAddError("a file name with an extension, e.g. helpers.py");
      return;
    }
    const rel = `${folder}/${base}`;
    if (files?.includes(rel)) {
      setAddError("that file already exists");
      return;
    }
    setAddError(null);
    const res = await fetch(writeUrl, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: rel, content: "" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error ?? `failed (${res.status})`);
      return;
    }
    setAdding(false);
    setNewFile("");
    setEditing(rel);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {files && files.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {files.map((f) => {
            // Relative to the folder: the frontmatter name is not the folder
            // name (page_check sits in page-check/).
            const label = folder && f.startsWith(`${folder}/`) ? f.slice(folder.length + 1) : f;
            const on = (editing ?? files[0]) === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setEditing(f)}
                aria-pressed={on}
                className={cn(
                  "inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-xs transition-colors",
                  on ? "border-line-strong bg-surface text-fg" : "border-transparent text-fg-muted hover:bg-muted hover:text-fg",
                )}
              >
                {label}
              </button>
            );
          })}
          {folder && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-muted hover:text-fg"
              title="Add another file to this folder — a helper module, a requirements file"
            >
              <Plus className="size-3.5" aria-hidden /> Add file
            </button>
          )}
          {adding && (
            <form
              className="flex flex-wrap items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void addFile();
              }}
            >
              <input
                autoFocus
                value={newFile}
                onChange={(e) => setNewFile(e.target.value)}
                placeholder="helpers.py"
                spellCheck={false}
                aria-label="New file name"
                className={cn(inputBase, "h-7 w-36 px-2 font-mono text-xs")}
              />
              <Button type="submit" variant="primary" size="xs" className="h-7 px-2.5">
                Add
              </Button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
                className="h-7 px-1.5 text-xs text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              {addError && <span className="text-xs text-danger">{addError}</span>}
            </form>
          )}
        </div>
      )}
      {/* One editor mounted across a folder's files: it caches each and
          switches without a refetch. */}
      <InlineEditor
        workspace={workspace || undefined}
        tenant={tenant}
        path={files?.length ? (editing ?? files[0]) : path}
        libraryKind={account ? kind : undefined}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
        hideSibling={Boolean(files && files.length > 1)}
        rows={22}
        bare
      />
    </div>
  );
}
