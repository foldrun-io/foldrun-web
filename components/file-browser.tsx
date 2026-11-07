"use client";

// Storage as a plain file browser, cloudhost-style: a breadcrumb path, a
// search box and a few filters, then one table of rows — an icon (or the
// picture itself), the name, size, age and sharing, and a menu on the end
// with download, share, stop sharing and delete. On the account page the
// first level is the desks; open one and its folders and files follow.
// Click a file and it previews as itself: a picture, a video, a PDF, the
// text. ←/→ step through what is listed; drop files on the list (or on a
// desk's row) to upload them there.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "@/components/kit/link";
import { useRouter } from "next/navigation";
import {
  Box,
  ChevronRight,
  Download,
  Ellipsis,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
  Link2,
  Mail,
  Share2,
  Trash2,
  Type,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { useConfirm } from "@/components/kit/confirm";
import { runHref } from "@/components/run-href";
import { Button, buttonVariants } from "@/components/kit/button";
import { Chip, EmptyState, IconBox } from "@/components/kit/page";
import { SearchField } from "@/components/kit/list";
import { Pager } from "@/components/kit/pager";
import { Toast } from "@/components/kit/toast";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/kit/menu";
import { cn } from "@/components/kit/cn";
import {
  FILTERS,
  fmtAge,
  fmtSize,
  kindOf,
  matches,
  previewAs,
  provenance,
  shareState,
  visibleDesks,
  type BrowserDesk,
  type BrowserFile,
  type BrowserFilter,
  type BrowserShare,
  type FileKind,
  type ServerPreview,
} from "@/components/file-browser-model";
import { Markdown } from "@/components/markdown";
import { relFor, uploadFile } from "@/components/upload";
import { useFilePicker } from "@/components/kit/file-button";
import { useCopyFallback } from "@/components/kit/prompt";
import { Tooltip } from "@/components/kit/tooltip";

const KIND_ICON: Record<FileKind, typeof FileIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileText,
  data: FileJson,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  page: FileCode,
  font: Type,
  model: Box,
  mail: Mail,
  other: FileIcon,
};

const base = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}/storage`;
const downloadHref = (f: BrowserFile) => `${base(f.workspace)}/download?path=${encodeURIComponent(f.path)}`;
const inlineHref = (f: BrowserFile) => `${downloadHref(f)}&inline=1`;
const keyOf = (f: { workspace: string; path: string }) => `${f.workspace}/${f.path}`;
const PAGE = 50;

/** A file's mark: the picture itself for an image, else an icon for its kind. */
function Thumb({ f, size = "size-9" }: { f: BrowserFile; size?: string }) {
  const [broken, setBroken] = useState(false);
  if (previewAs(f.path) === "image" && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a stored picture, served as itself
    return <img src={inlineHref(f)} alt="" loading="lazy" onError={() => setBroken(true)} className={cn(size, "shrink-0 rounded-md border border-line bg-sunken object-cover")} />;
  }
  const K = KIND_ICON[kindOf(f.path)];
  return (
    <span className={cn(size, "flex shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary")}>
      <K className="size-4" aria-hidden />
    </span>
  );
}


function SharePill({ share, now }: { share: BrowserShare | null; now: number }) {
  const s = shareState(share, now);
  if (s.state === "private") return <span className="text-fg-subtle">Private</span>;
  return (
    <Chip tone={s.soon ? "warn" : "good"}>
      <Link2 className="size-3" aria-hidden />
      {s.label.replace(/^shared · /, "")}
    </Chip>
  );
}

const th = "h-10 px-3 text-left align-middle text-[13px] font-medium whitespace-nowrap text-fg-muted";
const td = "h-16 px-3 py-2 align-middle whitespace-nowrap text-fg-secondary";

/** One row of the table: the mark, a name that is the row's button, a line
 *  under it, the size, the age, the sharing and an action at the end. */
function Row({
  mark,
  name,
  sub,
  size,
  age,
  ageTitle,
  sharing,
  action,
  onOpen,
  active = false,
  drop,
}: {
  mark: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  size: ReactNode;
  age: ReactNode;
  ageTitle?: string;
  sharing: ReactNode;
  action?: ReactNode;
  onOpen: () => void;
  active?: boolean;
  drop?: { on: boolean; label: string; over: (e: React.DragEvent) => void; leave: (e: React.DragEvent) => void; dropped: (e: React.DragEvent) => void };
}) {
  return (
    <tr
      className={cn("relative border-b border-line transition-colors hover:bg-sunken", active && "bg-sunken", drop?.on && "bg-info-soft")}
      onDragOver={drop?.over}
      onDragLeave={drop?.leave}
      onDrop={drop?.dropped}
    >
      <td className="h-16 px-3 py-2 align-middle">
        <span className="flex min-w-0 items-center gap-3">
          {mark}
          <span className="min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="block max-w-[14rem] truncate text-left font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus sm:max-w-[22rem] xl:max-w-[32rem]"
            >
              {name}
            </button>
            {drop?.on ? (
              <span className="block text-xs font-medium text-info">{drop.label}</span>
            ) : (
              sub && <span className="block max-w-[14rem] truncate text-xs text-fg-muted sm:max-w-[22rem] xl:max-w-[32rem]">{sub}</span>
            )}
          </span>
        </span>
      </td>
      <td className={cn(td, "text-right tabular-nums max-sm:hidden")}>{size}</td>
      <Tooltip label={ageTitle}><td className={cn(td, "max-sm:hidden")}>{age}</td></Tooltip>
      <td className={cn(td, "max-md:hidden")}>{sharing}</td>
      <td className="relative z-10 w-px px-3 py-2 text-right align-middle whitespace-nowrap">{action}</td>
    </tr>
  );
}

type DirRow = { name: string; files: number; bytes: number; latest: string; shared: number };

export function FileBrowser({
  desks: initial,
  tenant,
  now,
  canShare,
  single = false,
  toolbarExtra,
  workspaces,
}: {
  /** Every desk a file may be uploaded to — the toolbar's Upload offers them
   *  all, the empty ones included. Defaults to the desks listed. */
  workspaces?: string[];
  desks: BrowserDesk[];
  tenant: string;
  now: number;
  /** Whether this install has a public address a share can live at. */
  canShare: boolean;
  /** One desk's page: the desk is the root, no desk level above it. */
  single?: boolean;
  toolbarExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [copyFallback, copyDialog] = useCopyFallback();
  // Local edits (a share made, a file deleted) sit on the server's list until
  // the server sends a new one.
  const [desks, setDesks] = useState(initial);
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setDesks(initial);
  }
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<BrowserFilter>("all");
  // Where the browser stands: a desk (null = the desks, on the account page)
  // and a folder inside it ("" or "a/b/").
  const [at, setAt] = useState<{ desk: string | null; dir: string }>({ desk: single ? (initial[0]?.workspace ?? null) : null, dir: "" });
  const [offset, setOffset] = useState(0);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ workspace: string; done: number; total: number; name: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const picker = useFilePicker({ multiple: true, onFiles: (chosen) => void uploadTo(pending.current.desk, chosen, pending.current.dir) });
  const pending = useRef<{ desk: string; dir: string }>({ desk: "", dir: "" });
  const clearToast = useCallback(() => setToast(null), []);
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant }), [tenant]);
  const go = (desk: string | null, dir = "") => {
    setAt({ desk, dir });
    setOffset(0);
  };

  const searching = q.trim() !== "" || filter !== "all";
  const deskNow = useMemo(() => (at.desk ? desks.find((d) => d.workspace === at.desk) ?? { workspace: at.desk, files: [] } : null), [at.desk, desks]);
  const scopeDesks = useMemo(() => (deskNow ? [deskNow] : desks), [deskNow, desks]);
  const shown = useMemo(() => visibleDesks(scopeDesks, q, filter, now), [scopeDesks, q, filter, now]);
  const all = useMemo(() => desks.flatMap((d) => d.files), [desks]);
  const inScope = useMemo(() => scopeDesks.flatMap((d) => d.files), [scopeDesks]);
  const totalBytes = inScope.reduce((s, f) => s + f.size, 0);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((x) => [x.key, inScope.filter((f) => matches(f, "", x.key, now)).length])) as Record<BrowserFilter, number>, [inScope, now]);

  // What the table lists: matches across the scope while searching; the
  // desks at the account's root; else the folder's folders, then its files.
  const { folders, files } = useMemo(() => {
    if (searching) return { folders: [] as DirRow[], files: shown.flatMap((d) => d.files) };
    if (!deskNow) return { folders: [] as DirRow[], files: [] as BrowserFile[] };
    const dirs = new Map<string, DirRow>();
    const here: BrowserFile[] = [];
    for (const f of deskNow.files) {
      if (!f.path.startsWith(at.dir)) continue;
      const rest = f.path.slice(at.dir.length);
      const slash = rest.indexOf("/");
      if (slash < 0) {
        here.push(f);
        continue;
      }
      const name = rest.slice(0, slash);
      const d = dirs.get(name) ?? { name, files: 0, bytes: 0, latest: f.updatedAt, shared: 0 };
      d.files++;
      d.bytes += f.size;
      if (f.updatedAt > d.latest) d.latest = f.updatedAt;
      if (shareState(f.share, now).state === "shared") d.shared++;
      dirs.set(name, d);
    }
    return { folders: [...dirs.values()].sort((a, b) => a.name.localeCompare(b.name)), files: here };
  }, [searching, shown, deskNow, at.dir, now]);
  // A delete can shrink the list under the page being shown: clamp to the
  // last page that still has files, so nobody is left on an empty page.
  const lastPage = files.length ? Math.floor((files.length - 1) / PAGE) * PAGE : 0;
  const shownOffset = Math.min(offset, lastPage);
  const pageFiles = files.slice(shownOffset, shownOffset + PAGE);
  const current = previewKey ? files.find((f) => keyOf(f) === previewKey) ?? all.find((f) => keyOf(f) === previewKey) ?? null : null;

  const patch = (f: BrowserFile, change: Partial<BrowserFile> | null) =>
    setDesks((ds) => ds.map((d) => d.workspace !== f.workspace ? d : { ...d, files: change === null ? d.files.filter((x) => x.path !== f.path) : d.files.map((x) => (x.path === f.path ? { ...x, ...change } : x)) }));

  const copy = async (url: string, note: string) => {
    try { await navigator.clipboard.writeText(url); setToast(note); } catch { copyFallback(url); }
  };
  const share = async (f: BrowserFile) => {
    // A live link this viewer may copy is copied; one whose token is masked
    // (another person's, and this viewer is not an admin) is not theirs to
    // hand out, so Share mints them their own (30 Oct 2026).
    if (f.share?.url && shareState(f.share, now).state === "shared") return copy(f.share.url, "Link copied");
    setBusy(keyOf(f));
    try {
      const r = await fetch(`/api/workspaces/${encodeURIComponent(f.workspace)}/shares`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: `storage/${f.path}` }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `sharing failed (${r.status})`);
      const s: BrowserShare = { id: j.id, token: j.token, url: j.url, expiresAt: j.expiresAt ?? null };
      patch(f, { share: s });
      await copy(j.url, `Shared — link copied${s.expiresAt ? ", works for 7 days" : ""}`);
      // The page's link list reads the store too: read it again.
      router.refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const unshare = async (f: BrowserFile) => {
    if (!f.share) return;
    if (!(await confirm({ title: `Stop sharing ${f.path}?`, body: "The link stops working for everyone who has it.", confirmLabel: "Stop sharing" }))) return;
    const r = await fetch(`/api/workspaces/${encodeURIComponent(f.workspace)}/shares?id=${encodeURIComponent(f.share.id)}`, { method: "DELETE", headers });
    if (r.ok) { patch(f, { share: null }); setToast("No longer shared"); router.refresh(); } else setToast(`could not stop sharing (${r.status})`);
  };
  // Files into a desk (into the folder being looked at), one after another,
  // then the page reads the store again.
  const uploadTo = async (workspace: string, chosen: File[], dir = "") => {
    const list = chosen.filter((f) => f.size > 0 || f.name);
    if (!workspace || !list.length) return;
    let ok = 0;
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setUploading({ workspace, done: i, total: list.length, name: file.name });
      try {
        await uploadFile(workspace, tenant, file, relFor(file, dir));
        ok++;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
    }
    setUploading(null);
    // Show the desk it landed in.
    if (!single && at.desk !== workspace) go(workspace, dir);
    setToast(failed.length ? `${ok} uploaded to ${workspace}; ${failed.length} refused — ${failed[0]}` : `${ok} file${ok === 1 ? "" : "s"} uploaded to ${workspace}`);
    router.refresh();
  };
  const pickFor = (desk: string, dir = "") => {
    pending.current = { desk, dir };
    picker.open();
  };

  const remove = async (f: BrowserFile) => {
    if (!(await confirm({ title: `Delete ${f.path}?`, body: "Runs that expect to find it stop seeing it. This cannot be undone.", confirmLabel: "Delete" }))) return;
    const r = await fetch(`${base(f.workspace)}?path=${encodeURIComponent(f.path)}`, { method: "DELETE", headers });
    if (r.ok) { patch(f, null); setPreviewKey(null); setToast("Deleted"); router.refresh(); } else setToast(`delete failed (${r.status})`);
  };

  // Keys in the preview: Esc closes, ← → move through what is listed.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA"].includes(t.tagName)) return;
      const i = files.findIndex((f) => keyOf(f) === keyOf(current));
      if (e.key === "Escape") setPreviewKey(null);
      else if (e.key === "ArrowRight" && i >= 0 && i < files.length - 1) setPreviewKey(keyOf(files[i + 1]));
      else if (e.key === "ArrowLeft" && i > 0) setPreviewKey(keyOf(files[i - 1]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, files]);

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const uploadable = workspaces ?? desks.map((d) => d.workspace);
  const isShared = (f: BrowserFile) => shareState(f.share, now).state === "shared" && !!f.share?.url;
  const shareLabel = (f: BrowserFile) => (busy === keyOf(f) ? "Sharing…" : isShared(f) ? "Copy link" : "Share");
  const shareTitle = (f: BrowserFile) => (!canShare ? "This install has no public address to share from" : isShared(f) ? "Copy the public link" : "Make a public link (7 days) and copy it");

  // Drop zones: a desk's row, or the table while inside a desk.
  const dropFor = (desk: string, dir: string, id: string) => ({
    on: dropOn === id,
    over: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(id);
      }
    },
    leave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(null);
    },
    dropped: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      void uploadTo(desk, Array.from(e.dataTransfer.files), dir);
    },
  });

  const fileMenu = (f: BrowserFile) => (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.path}`}>
          <Ellipsis />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => setPreviewKey(keyOf(f))}>
          <Eye /> Preview
        </MenuItem>
        <MenuItem asChild>
          <a href={downloadHref(f)}>
            <Download /> Download
          </a>
        </MenuItem>
        <Tooltip label={shareTitle(f)} side="left">
          <div>
            <MenuItem disabled={!canShare || busy === keyOf(f)} onSelect={() => void share(f)}>
              {isShared(f) ? <Link2 /> : <Share2 />} {shareLabel(f)}
            </MenuItem>
          </div>
        </Tooltip>
        {f.share && shareState(f.share, now).state === "shared" && (
          <MenuItem onSelect={() => void unshare(f)}>
            <Unlink /> Stop sharing
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem tone="danger" onSelect={() => void remove(f)}>
          <Trash2 /> Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );

  const fileRow = (f: BrowserFile, showDir: boolean) => {
    const slash = f.path.lastIndexOf("/");
    const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
    const name = f.path.slice(slash + 1);
    const by = provenance(f.by);
    return (
      <Row
        key={keyOf(f)}
        mark={<Thumb f={f} />}
        name={
          <>
            {showDir && !at.desk && <span className="font-normal text-fg-muted">{f.workspace} · </span>}
            {showDir && dir && <span className="font-normal text-fg-muted">{dir}</span>}
            {name}
          </>
        }
        sub={
          <>
            {by.kind === "run" ? <>from {by.agent} · run</> : by.kind === "user" ? <>uploaded by {by.who}</> : "stored"}
            <span className="sm:hidden"> · {fmtSize(f.size)} · {fmtAge(f.updatedAt, now)}</span>
          </>
        }
        size={fmtSize(f.size)}
        age={fmtAge(f.updatedAt, now)}
        ageTitle={f.updatedAt}
        sharing={<SharePill share={f.share} now={now} />}
        action={fileMenu(f)}
        onOpen={() => setPreviewKey(keyOf(f))}
        active={previewKey === keyOf(f)}
      />
    );
  };

  // The path, as links back up.
  const crumbs: { label: ReactNode; onClick?: () => void }[] = [];
  if (!single) crumbs.push({ label: "All desks", onClick: at.desk ? () => go(null) : undefined });
  if (at.desk) {
    crumbs.push({ label: single ? "storage" : at.desk, onClick: at.dir && !searching ? () => go(at.desk) : undefined });
    // A search covers the whole desk, so the path stops at the desk.
    const parts = searching ? [] : at.dir.split("/").filter(Boolean);
    parts.forEach((p, i) => crumbs.push({ label: p, onClick: i < parts.length - 1 ? () => go(at.desk, `${parts.slice(0, i + 1).join("/")}/`) : undefined }));
  }

  const tableDrop = at.desk && !searching ? dropFor(at.desk, at.dir, `table:${at.desk}`) : null;
  const empty = searching ? !files.length : at.desk ? !folders.length && !files.length : !desks.length;

  return (
    <div className="min-w-0">
      {/* Above the preview panel: a confirmation asked from inside it must
          not open underneath it. */}
      <div className="relative z-[70]">{confirmDialog}{copyDialog}</div>
      {toast && <Toast onDone={clearToast}>{toast}</Toast>}
      {uploading && (
        <Toast>
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-info" />
          <span className="truncate">
            Uploading {uploading.name} to {uploading.workspace} · {uploading.done + 1} of {uploading.total}
          </span>
        </Toast>
      )}
      {picker.input}

      {/* Find, and narrow. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchField
          value={q}
          onChange={(v) => {
            setQ(v);
            setOffset(0);
          }}
          placeholder={at.desk ? (single ? "Find a file…" : `Find a file in ${at.desk}…`) : "Find a file in any desk…"}
          className="min-w-48 flex-1"
        />
        <div role="group" aria-label="Filter" className="inline-flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-sunken p-0.5">
          {FILTERS.filter((x) => x.key === "all" || counts[x.key] > 0).map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={filter === x.key}
              onClick={() => {
                setFilter(x.key);
                setOffset(0);
              }}
              className={cn(
                "flex h-full shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium transition-colors",
                filter === x.key ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-fg-muted hover:text-fg",
              )}
            >
              {x.label}
              <span className="tabular-nums text-fg-subtle">{counts[x.key]}</span>
            </button>
          ))}
        </div>
        {toolbarExtra}
        {!single && uploadable.length > 0 && (
          at.desk ? (
            <Tooltip label={`Upload files to ${at.desk} — or drop them on the list`}>
              <Button variant="primary" size="lg" onClick={() => pickFor(at.desk!, at.dir)}>
                <Upload /> Upload
              </Button>
            </Tooltip>
          ) : (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="primary" size="lg">
                  <Upload /> Upload
                </Button>
              </MenuTrigger>
              <MenuContent className="max-w-72">
                <MenuLabel>To which desk</MenuLabel>
                {uploadable.map((w) => (
                  <MenuItem key={w} onSelect={() => pickFor(w)}>
                    <HardDrive /> {w}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <p className="px-2 py-1.5 text-xs text-fg-muted">
                  Any file, up to 512 MB each. Its runs read it at <code className="font-mono">workspace/storage/</code>.
                </p>
              </MenuContent>
            </Menu>
          )
        )}
      </div>

      {/* Where you are, and how much is here. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <nav aria-label="Path" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
              {c.onClick ? (
                <button type="button" onClick={c.onClick} className="truncate text-fg-muted transition-colors hover:text-fg">
                  {c.label}
                </button>
              ) : (
                <span className="truncate font-medium text-fg" aria-current="page">
                  {c.label}
                </span>
              )}
            </Fragment>
          ))}
          {searching && <span className="text-fg-muted">· matches</span>}
        </nav>
        <span className="text-[13px] tabular-nums text-fg-muted">
          {inScope.length} file{inScope.length === 1 ? "" : "s"} · {fmtSize(totalBytes)}
        </span>
      </div>

      {empty ? (
        <div onDragOver={tableDrop?.over} onDragLeave={tableDrop?.leave} onDrop={tableDrop?.dropped} className={cn("rounded-lg transition-shadow", tableDrop?.on && "ring-2 ring-focus")}>
          <EmptyState
            icon={searching ? <FileIcon /> : <HardDrive />}
            title={searching ? "Nothing matches" : at.desk ? (at.dir ? "This folder is empty" : "Nothing stored yet") : "Nothing stored yet"}
            description={
              searching
                ? "Try another word, or clear the filter."
                : at.desk
                  ? "Drop files here or use Upload. Runs write theirs to storage/."
                  : "Upload a file to a desk, or let a run write one to storage/."
            }
            action={
              searching ? (
                <Button
                  onClick={() => {
                    setQ("");
                    setFilter("all");
                  }}
                >
                  Clear
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div
          onDragOver={tableDrop?.over}
          onDragLeave={tableDrop?.leave}
          onDrop={tableDrop?.dropped}
          className={cn("relative overflow-x-auto rounded-lg border bg-surface transition-colors", tableDrop?.on ? "border-info-line ring-2 ring-focus" : "border-line")}
        >
          {tableDrop?.on && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-info-soft/90 text-sm font-medium text-info">
              Drop to upload to {at.desk}/{at.dir}
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-sunken">
              <tr className="border-b border-line">
                <th className={th}>{at.desk || searching ? "Name" : "Desk"}</th>
                <th className={cn(th, "text-right max-sm:hidden")}>Size</th>
                <th className={cn(th, "max-sm:hidden")}>Modified</th>
                <th className={cn(th, "max-md:hidden")}>Sharing</th>
                <th className="w-px px-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {!at.desk && !searching &&
                desks.map((d) => {
                  const bytes = d.files.reduce((s, f) => s + f.size, 0);
                  const sharedN = d.files.filter((f) => shareState(f.share, now).state === "shared").length;
                  const latest = d.files.reduce((m, f) => (f.updatedAt > m ? f.updatedAt : m), "");
                  return (
                    <Row
                      key={d.workspace}
                      mark={
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ink text-sm font-semibold uppercase text-on-ink">{d.workspace[0]}</span>
                      }
                      name={d.workspace}
                      sub={`${d.files.length} file${d.files.length === 1 ? "" : "s"}`}
                      size={fmtSize(bytes)}
                      age={latest ? fmtAge(latest, now) : "—"}
                      ageTitle={latest || undefined}
                      sharing={sharedN > 0 ? <Chip tone="good">{sharedN} shared</Chip> : <span className="text-fg-subtle">—</span>}
                      onOpen={() => go(d.workspace)}
                      drop={{ ...dropFor(d.workspace, "", `desk:${d.workspace}`), label: `Drop to upload to ${d.workspace}` }}
                      action={
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.workspace}`}>
                              <Ellipsis />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => go(d.workspace)}>
                              <Folder /> Open
                            </MenuItem>
                            <Tooltip label={`Upload files to ${d.workspace} — or drop them on its row`} side="left">
                              <MenuItem onSelect={() => pickFor(d.workspace)}>
                                <Upload /> Upload files…
                              </MenuItem>
                            </Tooltip>
                            <MenuItem asChild>
                              <Link href={`/dashboard/${d.workspace}/storage${qs}`}>
                                <HardDrive /> Open desk page
                              </Link>
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      }
                    />
                  );
                })}
              {folders.map((d) => (
                <Row
                  key={`dir:${d.name}`}
                  mark={
                    <IconBox className="text-fg-secondary">
                      <Folder />
                    </IconBox>
                  }
                  name={d.name}
                  sub={`${d.files} file${d.files === 1 ? "" : "s"}`}
                  size={fmtSize(d.bytes)}
                  age={fmtAge(d.latest, now)}
                  ageTitle={d.latest}
                  sharing={d.shared > 0 ? <Chip tone="good">{d.shared} shared</Chip> : <span className="text-fg-subtle">—</span>}
                  onOpen={() => go(at.desk, `${at.dir}${d.name}/`)}
                />
              ))}
              {pageFiles.map((f) => fileRow(f, searching))}
            </tbody>
          </table>
        </div>
      )}
      {files.length > PAGE && <Pager page={shownOffset / PAGE + 1} pages={Math.ceil(files.length / PAGE)} total={files.length} pageSize={PAGE} onPage={(n) => setOffset((n - 1) * PAGE)} />}

      {/* The preview: the file as itself, and what is known about it. */}
      {current && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setPreviewKey(null)}>
          <aside data-preview className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface shadow-menu" onClick={(e) => e.stopPropagation()} aria-label="File preview">
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <Thumb f={current} size="size-10" />
              <div className="min-w-0 flex-1">
                <Tooltip label={current.path}><p className="truncate text-base font-semibold text-fg">{current.path.split("/").pop()}</p></Tooltip>
                <p className="truncate text-[13px] text-fg-muted">{current.workspace} · storage/{current.path}</p>
              </div>
              <Tooltip label="Close (Esc)">
                <Button variant="ghost" size="icon-sm" onClick={() => setPreviewKey(null)} aria-label="Close">
                  <X />
                </Button>
              </Tooltip>
            </header>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-sunken px-5 py-2.5 text-[13px] text-fg-secondary">
              <span className="tabular-nums">{fmtSize(current.size)}</span>
              <Tooltip label={current.updatedAt}><span>modified {fmtAge(current.updatedAt, now)}</span></Tooltip>
              {(() => {
                const by = provenance(current.by);
                if (by.kind === "run") return <Link href={runHref(current.workspace, by.runId, tenant)} className="font-medium text-link hover:underline">from {by.agent} · open the run</Link>;
                if (by.kind === "user") return <span>uploaded by {by.who}</span>;
                return null;
              })()}
              <SharePill share={current.share} now={now} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted p-4">
              <Preview key={keyOf(current)} f={current} />
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              <a href={downloadHref(current)} className={buttonVariants({ variant: "secondary", size: "md" })}>
                <Download /> Download
              </a>
              <Tooltip label={shareTitle(current)}>
                <span className="inline-flex">
                  <Button variant={isShared(current) ? "secondary" : "primary"} size="md" disabled={!canShare || busy === keyOf(current)} onClick={() => void share(current)}>
                    {isShared(current) ? <Link2 /> : <Share2 />} {shareLabel(current)}
                  </Button>
                </span>
              </Tooltip>
              {current.share && shareState(current.share, now).state === "shared" && (
                <Button variant="ghost" size="md" onClick={() => void unshare(current)}>
                  Stop sharing
                </Button>
              )}
              <span className="ml-auto hidden text-xs text-fg-subtle sm:inline">
                <kbd className="rounded border border-line px-1">←</kbd> <kbd className="rounded border border-line px-1">→</kbd> next file · <kbd className="rounded border border-line px-1">esc</kbd> close
              </span>
              <Button variant="danger-outline" size="md" onClick={() => void remove(current)} className="max-sm:ml-auto">
                <Trash2 /> Delete
              </Button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}

function Preview({ f }: { f: BrowserFile }) {
  // A browser that cannot play or draw a native type (an .mkv without the
  // codec, an .aiff in Chrome) falls back to the server's reading of it.
  const [fallback, setFallback] = useState(false);
  const as = fallback ? "server" : previewAs(f.path);
  const [data, setData] = useState<ServerPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (as !== "server") return;
    let alive = true;
    fetch(`${base(f.workspace)}/preview?path=${encodeURIComponent(f.path)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `the platform answered ${r.status}`);
        if (alive) setData(j as ServerPreview);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => { alive = false; };
  }, [as, f]);

  if (as === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- a stored picture, served as itself
    return <img src={inlineHref(f)} alt={f.path} onError={() => setFallback(true)} className="mx-auto max-h-full max-w-full rounded-lg bg-surface object-contain shadow-sm" />;
  }
  if (as === "video") return <video key={f.path} src={inlineHref(f)} controls playsInline preload="metadata" onError={() => setFallback(true)} className="mx-auto max-h-full w-full rounded-lg bg-black shadow-sm" />;
  if (as === "audio") return <div className="flex h-full items-center justify-center"><audio key={f.path} src={inlineHref(f)} controls onError={() => setFallback(true)} className="w-full max-w-lg" /></div>;
  if (as === "font") return <FontSample f={f} onFail={() => setFallback(true)} />;
  if (as === "pdf") return <iframe key={f.path} src={inlineHref(f)} title={f.path} className="h-full min-h-[70vh] w-full rounded-lg border border-line bg-surface shadow-sm" />;
  if (error) return <NoPreview f={f} note={`No preview: ${error}`} />;
  if (fallback && data?.kind === "binary") return <ServerView f={f} p={{ ...data, note: data.note ?? `Your browser cannot ${kindOf(f.path) === "video" || kindOf(f.path) === "audio" ? "play" : "show"} this format itself. Download it to open it.` }} />;
  if (!data) return <p className="p-6 text-center text-xs text-fg-subtle">Reading the file…</p>;
  return <ServerView f={f} p={data} />;
}

const Paper = ({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) => (
  <div className={`mx-auto min-h-full rounded-lg border border-line bg-surface shadow-sm ${wide ? "" : "max-w-3xl"}`}>{children}</div>
);
const Cut = ({ show, what = "the rest is in the download" }: { show: boolean; what?: string }) =>
  show ? <p className="border-t border-line-faint px-4 py-2 text-[11px] text-fg-subtle">Showing the start — {what}.</p> : null;

function ServerView({ f, p }: { f: BrowserFile; p: ServerPreview }) {
  const [tab, setTab] = useState(0);
  const [source, setSource] = useState(false);
  switch (p.kind) {
    case "text":
      if (p.format === "markdown" && !source) {
        // Frontmatter is the file's settings, not its prose: shown apart.
        const fm = p.text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        return (
          <Paper>
            <div className="flex justify-end px-4 pt-3"><button type="button" onClick={() => setSource(true)} className="text-[11px] text-fg-subtle hover:text-fg-secondary">view source</button></div>
            {fm && <pre className="mx-8 mb-4 overflow-auto rounded-md border border-line-faint bg-sunken px-3 py-2 font-mono text-[11.5px] text-fg-tertiary">{fm[1]}</pre>}
            <div className="px-8 pb-8"><Markdown text={fm ? p.text.slice(fm[0].length) : p.text} className="text-[15px] leading-relaxed text-fg" /></div>
            <Cut show={p.truncated} />
          </Paper>
        );
      }
      return (
        <Paper wide>
          <div className="flex items-center gap-2 border-b border-line-faint px-4 py-1.5 text-[11px] text-fg-subtle">
            <span>{p.format === "code" ? p.language : p.format === "markdown" ? "markdown source" : p.format === "json" ? "JSON" : "text"}</span>
            {p.format === "markdown" && <button type="button" onClick={() => setSource(false)} className="ml-auto hover:text-fg-secondary">rendered</button>}
          </div>
          <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-fg">{p.text || "(empty)"}</pre>
          <Cut show={p.truncated} />
        </Paper>
      );
    case "table": {
      const sheet = p.sheets[Math.min(tab, p.sheets.length - 1)];
      if (!sheet) return <NoPreview f={f} note="The spreadsheet has no sheets." />;
      const [head, ...body] = sheet.rows;
      const cols = Math.max(0, ...sheet.rows.map((r) => r.length));
      return (
        <Paper wide>
          {p.sheets.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-line-faint px-3 py-2">
              {p.sheets.map((sh, i) => (
                <button key={sh.name + i} type="button" onClick={() => setTab(i)} className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${i === tab ? "bg-ink text-on-ink" : "text-fg-tertiary hover:bg-muted"}`}>{sh.name}</button>
              ))}
            </div>
          )}
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-[12px]">
              {head && (
                <thead className="sticky top-0 bg-sunken">
                  <tr>
                    <th className="border-b border-r border-line px-2 py-1.5 text-right font-normal text-fg-subtle">#</th>
                    {Array.from({ length: cols }, (_, c) => <th key={c} className="whitespace-nowrap border-b border-r border-line px-3 py-1.5 text-left font-semibold text-fg">{head[c] ?? ""}</th>)}
                  </tr>
                </thead>
              )}
              <tbody>
                {body.map((r, i) => (
                  <tr key={i} className="odd:bg-surface even:bg-sunken/60 hover:bg-muted">
                    <td className="border-r border-line-faint px-2 py-1 text-right tabular-nums text-fg-subtle">{i + 2}</td>
                    {Array.from({ length: cols }, (_, c) => <Tooltip key={c} label={r[c] ?? ""}><td className="max-w-[24rem] truncate border-r border-line-faint px-3 py-1 text-fg-secondary">{r[c] ?? ""}</td></Tooltip>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line-faint px-4 py-2 text-[11px] text-fg-subtle">{sheet.rows.length} row{sheet.rows.length === 1 ? "" : "s"} · {cols} column{cols === 1 ? "" : "s"}{sheet.truncated ? " — the first 500; the rest is in the download" : ""}</p>
        </Paper>
      );
    }
    case "document":
      return (
        <Paper>
          {p.note && <p className="border-b border-warning-line bg-warning-soft px-6 py-2 text-xs text-warning">{p.note}</p>}
          <article className="space-y-3 px-10 py-10 font-serif text-[15px] leading-relaxed text-fg">
            {p.blocks.length === 0 && <p className="font-sans text-sm text-fg-subtle">The document has no text.</p>}
            {p.blocks.map((b, i) =>
              b.style === "h1" ? <h2 key={i} className="pt-2 font-sans text-xl font-semibold text-fg">{b.text}</h2>
              : b.style === "h2" ? <h3 key={i} className="pt-1 font-sans text-lg font-semibold text-fg">{b.text}</h3>
              : b.style === "h3" ? <h4 key={i} className="font-sans text-base font-semibold text-fg">{b.text}</h4>
              : b.style === "li" ? <p key={i} className="flex gap-2 pl-2"><span className="text-fg-subtle">•</span><span className="whitespace-pre-wrap">{b.text}</span></p>
              : <p key={i} className="whitespace-pre-wrap">{b.text}</p>,
            )}
          </article>
          <Cut show={p.truncated} />
        </Paper>
      );
    case "slides":
      return (
        <div className="mx-auto max-w-3xl space-y-3">
          {p.slides.length === 0 && <NoPreview f={f} note="The deck has no slides with text." />}
          {p.slides.map((sl, i) => (
            <div key={i} className="aspect-[16/9] overflow-hidden rounded-lg border border-line bg-surface p-8 shadow-sm">
              <p className="text-xs text-fg-muted">Slide {i + 1}</p>
              <h3 className="mt-2 text-xl font-semibold text-fg">{sl.title}</h3>
              <ul className="mt-3 space-y-1 text-sm text-fg-secondary">{sl.lines.slice(0, 14).map((l, j) => <li key={j} className="flex gap-2"><span className="text-fg-subtle">•</span>{l}</li>)}</ul>
            </div>
          ))}
        </div>
      );
    case "archive":
      return (
        <Paper wide>
          <p className="border-b border-line-faint px-4 py-2 text-xs text-fg-muted">{p.entries.length} item{p.entries.length === 1 ? "" : "s"} inside</p>
          <ul className="divide-y divide-line-faint font-mono text-[12px]">
            {p.entries.map((e) => (
              <li key={e.name} className="flex gap-4 px-4 py-1"><span className="min-w-0 flex-1 truncate text-fg">{e.name}</span><span className="shrink-0 tabular-nums text-fg-subtle">{e.name.endsWith("/") ? "" : fmtSize(e.size)}</span></li>
            ))}
          </ul>
          <Cut show={p.truncated} what="the first 2,000 entries" />
        </Paper>
      );
    case "html":
      return (
        <Paper wide>
          <div className="flex items-center gap-1 border-b border-line-faint px-3 py-1.5 text-[11px]">
            <button type="button" onClick={() => setSource(false)} className={`rounded px-2 py-0.5 ${!source ? "bg-muted text-fg" : "text-fg-muted hover:text-fg"}`}>Page</button>
            <button type="button" onClick={() => setSource(true)} className={`rounded px-2 py-0.5 ${source ? "bg-muted text-fg" : "text-fg-muted hover:text-fg"}`}>Source</button>
            <span className="ml-auto text-fg-subtle">scripts off — shown in a sealed frame</span>
          </div>
          {source ? (
            <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-fg">{p.html}</pre>
          ) : (
            // sandbox with no allowances: no script, no forms, no top
            // navigation, an opaque origin — the page's look, none of its reach.
            <iframe sandbox="" srcDoc={p.html} title={f.path} className="h-[70vh] w-full rounded-b-lg bg-surface" />
          )}
          <Cut show={p.truncated} />
        </Paper>
      );
    case "svg":
      // As a picture: an <img> never runs an SVG's script.
      // eslint-disable-next-line @next/next/no-img-element -- an SVG drawn from its text
      return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`} alt={f.path} className="mx-auto max-h-full max-w-full rounded-lg bg-surface p-4 shadow-sm" />;
    case "image":
      return (
        <div className="flex h-full flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture read out of the file */}
          <img src={`data:${p.mime};base64,${p.data}`} alt={f.path} className="max-h-[calc(100%-2rem)] max-w-full rounded-lg bg-surface object-contain shadow-sm" />
          <p className="text-[11px] text-fg-muted">{p.note}</p>
        </div>
      );
    case "email":
      return (
        <Paper>
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 border-b border-line-faint px-6 py-4 text-sm">
            {p.headers.map((h, i) => <Fragment key={i}><dt className="text-fg-subtle">{h.name}</dt><dd className={`break-words ${/subject/i.test(h.name) ? "font-semibold text-fg" : "text-fg-secondary"}`}>{h.value}</dd></Fragment>)}
          </dl>
          {p.attachments.length > 0 && <p className="border-b border-line-faint px-6 py-2 text-xs text-fg-muted">{p.attachments.join(" · ")}</p>}
          <pre className="whitespace-pre-wrap break-words px-6 py-5 font-sans text-sm leading-relaxed text-fg">{p.body || "(no text body)"}</pre>
        </Paper>
      );
    case "calendar":
      return (
        <Paper>
          <p className="border-b border-line-faint px-5 py-2 text-xs text-fg-muted">{p.events.length} event{p.events.length === 1 ? "" : "s"}</p>
          <ul className="divide-y divide-line-faint">
            {p.events.map((e, i) => (
              <li key={i} className="flex gap-4 px-5 py-3">
                <span className="w-36 shrink-0 text-xs tabular-nums text-fg-muted">{e.start}{e.end ? <><br />→ {e.end}</> : null}</span>
                <span className="min-w-0"><span className="block text-sm font-medium text-fg">{e.title || "(untitled)"}</span>{e.where && <span className="block text-xs text-fg-muted">{e.where}</span>}{e.notes && <span className="mt-1 block whitespace-pre-wrap text-xs text-fg-tertiary">{e.notes}</span>}</span>
              </li>
            ))}
          </ul>
        </Paper>
      );
    case "contacts":
      return (
        <div className="mx-auto grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
          {p.people.map((c, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <p className="text-sm font-semibold text-fg">{c.name}</p>
              {c.lines.map((l, j) => <Tooltip key={j} label={l}><p className="truncate text-xs text-fg-tertiary">{l}</p></Tooltip>)}
            </div>
          ))}
        </div>
      );
    case "notebook":
      return (
        <div className="mx-auto max-w-3xl space-y-3">
          {p.cells.map((c, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
              {c.type === "markdown" ? (
                <div className="px-6 py-4"><Markdown text={c.source} className="text-sm text-fg" /></div>
              ) : (
                <>
                  <pre className="overflow-auto bg-sunken px-4 py-3 font-mono text-[12px] text-fg"><span className="mr-2 select-none text-info">In [{i + 1}]</span>{c.source}</pre>
                  {c.outputs.map((o, j) => <pre key={j} className="overflow-auto border-t border-line-faint px-4 py-2 font-mono text-[12px] text-fg-tertiary">{o}</pre>)}
                </>
              )}
            </div>
          ))}
        </div>
      );
    case "link":
      return (
        <div className="flex h-full min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-fg-muted">A saved link</p>
          <a href={p.url} target="_blank" rel="noreferrer noopener" className="max-w-lg break-all text-lg font-medium text-link underline-offset-2 hover:underline">{p.url}</a>
        </div>
      );
    case "mesh":
      return <MeshView p={p} />;
    case "binary":
      return (
        <Paper wide>
          <p className="border-b border-line-faint px-4 py-2 text-xs text-fg-muted">{p.note ?? "A binary file — no reader for this kind. Its first bytes:"}</p>
          <pre className="overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-fg-secondary">{p.hex}</pre>
          <Cut show={p.size > 1024} what="download it to open it in the program it belongs to" />
        </Paper>
      );
  }
}

/** A font, drawn: loaded from the file into the page as a FontFace. */
function FontSample({ f, onFail }: { f: BrowserFile; onFail: () => void }) {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const name = `preview-${Math.random().toString(36).slice(2)}`;
    fetch(inlineHref(f))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => new FontFace(name, buf).load())
      .then((face) => { document.fonts.add(face); if (alive) setFamily(name); })
      .catch(() => alive && onFail());
    return () => { alive = false; };
  }, [f, onFail]);
  if (!family) return <p className="p-6 text-center text-xs text-fg-subtle">Loading the font…</p>;
  return (
    <Paper>
      <div className="space-y-5 px-10 py-10" style={{ fontFamily: `"${family}"` }}>
        {[64, 40, 24, 16].map((px) => <p key={px} style={{ fontSize: px, lineHeight: 1.15 }} className="text-fg">The quick brown fox jumps over the lazy dog</p>)}
        <p className="break-all text-2xl text-fg-secondary">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &amp;@$%!?</p>
      </div>
    </Paper>
  );
}

/** A 3D model, drawn on a canvas: flat-shaded, drag to turn it. */
function MeshView({ p }: { p: Extract<ServerPreview, { kind: "mesh" }> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [angle, setAngle] = useState({ yaw: -0.6, pitch: -0.45 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const geo = useMemo(() => {
    const t = p.triangles;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], t[i + k]); max[k] = Math.max(max[k], t[i + k]); }
    const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const s = Math.max(...[0, 1, 2].map((k) => max[k] - min[k])) || 1;
    return { c, s };
  }, [p.triangles]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    const W = (el.width = el.clientWidth * devicePixelRatio);
    const H = (el.height = el.clientHeight * devicePixelRatio);
    // The ground follows the theme; the model's own shading does not.
    ctx.fillStyle = getComputedStyle(el).getPropertyValue("--color-slate-50").trim() || "white";
    ctx.fillRect(0, 0, W, H);
    const { yaw, pitch } = angle;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = (Math.min(W, H) * 0.55) / geo.s;
    // Rotate in model units; project only to draw. Shading comes from the
    // rotated normal against a light from the upper left, so each face of
    // the model reads as its own plane.
    const rot = (i: number) => {
      const x = p.triangles[i] - geo.c[0], y = p.triangles[i + 1] - geo.c[1], z = p.triangles[i + 2] - geo.c[2];
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
    const L = [-0.45, 0.6, 0.66];
    const faces: { pts: number[][]; depth: number; shade: number }[] = [];
    for (let i = 0; i < p.triangles.length; i += 9) {
      const a = rot(i), b = rot(i + 3), c = rot(i + 6);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const lit = Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / len);
      const px = (v: number[]) => [W / 2 + v[0] * scale, H / 2 - v[1] * scale];
      faces.push({ pts: [px(a), px(b), px(c)], depth: (a[2] + b[2] + c[2]) / 3, shade: 0.25 + 0.75 * lit });
    }
    faces.sort((u, v) => u.depth - v.depth);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(0.5, devicePixelRatio * 0.5);
    for (const fc of faces) {
      const l = fc.shade;
      ctx.fillStyle = `rgb(${Math.round(40 + 90 * l)},${Math.round(90 + 110 * l)},${Math.round(140 + 110 * l)})`;
      ctx.strokeStyle = faces.length < 4000 ? "rgba(15,23,42,0.18)" : ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(fc.pts[0][0], fc.pts[0][1]); ctx.lineTo(fc.pts[1][0], fc.pts[1][1]); ctx.lineTo(fc.pts[2][0], fc.pts[2][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, [angle, geo, p.triangles]);
  return (
    <div className="flex h-full flex-col gap-2">
      <canvas
        ref={canvas}
        className="h-[60vh] w-full cursor-grab rounded-lg border border-line bg-sunken shadow-sm active:cursor-grabbing"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setAngle((a) => ({ yaw: a.yaw + dx * 0.01, pitch: Math.max(-1.5, Math.min(1.5, a.pitch + dy * 0.01)) }));
        }}
        onPointerUp={() => { drag.current = null; }}
      />
      <p className="text-center text-[11px] text-fg-muted">{String(p.count).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} triangles{p.truncated ? " (the first 60,000 drawn)" : ""} · drag to turn</p>
    </div>
  );
}

function NoPreview({ f, note }: { f: BrowserFile; note: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <Thumb f={f} size="h-14 w-14" />
      <p className="max-w-sm text-sm text-fg-tertiary">{note}</p>
      <a href={downloadHref(f)} className={buttonVariants({ variant: "primary", size: "md" })}>
        <Download /> Download
      </a>
    </div>
  );
}
