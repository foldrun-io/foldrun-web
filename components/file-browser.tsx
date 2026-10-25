"use client";

// Storage as a plain file browser. One card per desk, a row per file — its
// name, size, age, where it came from and whether it is shared — with the
// two things people do with a file right on the row: download it, share it.
// Click a row and it previews as itself: a picture, a video, a PDF, the
// text. Search and a few chips narrow it; ←/→ step through the previews.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm";
import { runHref } from "@/components/run-href";
import { buttonClass } from "@/components/ui";
import { CollapsibleCard, CollapseAll, setCardsOpen } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
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

const KIND_BADGE: Record<FileKind, { label: string; tone: string }> = {
  image: { label: "IMG", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  video: { label: "VID", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  audio: { label: "AUD", tone: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  pdf: { label: "PDF", tone: "bg-red-50 text-red-700 ring-red-200" },
  text: { label: "TXT", tone: "bg-sunken text-fg-secondary ring-line" },
  data: { label: "DATA", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  sheet: { label: "CSV", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  archive: { label: "ZIP", tone: "bg-stone-100 text-stone-700 ring-stone-300" },
  page: { label: "HTML", tone: "bg-orange-50 text-orange-700 ring-orange-200" },
  font: { label: "FONT", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  model: { label: "3D", tone: "bg-teal-50 text-teal-700 ring-teal-200" },
  mail: { label: "MAIL", tone: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  other: { label: "FILE", tone: "bg-sunken text-fg-muted ring-line" },
};

const base = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}/storage`;
const downloadHref = (f: BrowserFile) => `${base(f.workspace)}/download?path=${encodeURIComponent(f.path)}`;
const inlineHref = (f: BrowserFile) => `${downloadHref(f)}&inline=1`;
const keyOf = (f: { workspace: string; path: string }) => `${f.workspace}/${f.path}`;

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
const I = {
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  close: "M18 6 6 18M6 6l12 12",
  chevron: "m9 18 6-6-6-6",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
};

function Thumb({ f, size = "h-10 w-10" }: { f: BrowserFile; size?: string }) {
  const k = kindOf(f.path);
  const [broken, setBroken] = useState(false);
  if (previewAs(f.path) === "image" && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a stored picture, served as itself
    return <img src={inlineHref(f)} alt="" loading="lazy" onError={() => setBroken(true)} className={`${size} shrink-0 rounded-md border border-line bg-sunken object-cover`} />;
  }
  const b = KIND_BADGE[k];
  return <span className={`${size} flex shrink-0 items-center justify-center rounded-md text-[9px] font-bold tracking-wide ring-1 ring-inset ${b.tone}`}>{b.label}</span>;
}

function SharePill({ share, now }: { share: BrowserShare | null; now: number }) {
  const s = shareState(share, now);
  if (s.state === "private") return <span className="text-[11px] text-fg-subtle">private</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.soon ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
      <Icon d={I.link} className="h-3 w-3" />
      {s.label.replace(/^shared · /, "")}
    </span>
  );
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 2600);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink/95 px-4 py-2 text-sm text-on-ink shadow-lg">{text}</div>
  );
}

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
  /** One desk's page: no desk headers to repeat the name. */
  single?: boolean;
  toolbarExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
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
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ workspace: string; done: number; total: number; name: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [target, setTarget] = useState<string>(workspaces?.[0] ?? initial[0]?.workspace ?? "");
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingDesk = useRef<string>("");
  const clearToast = useCallback(() => setToast(null), []);
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant }), [tenant]);

  const shown = useMemo(() => visibleDesks(desks, q, filter, now), [desks, q, filter, now]);
  const flat = useMemo(() => shown.flatMap((d) => d.files), [shown]);
  const all = useMemo(() => desks.flatMap((d) => d.files), [desks]);
  const totalBytes = all.reduce((s, f) => s + f.size, 0);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((x) => [x.key, all.filter((f) => matches(f, "", x.key, now)).length])) as Record<BrowserFilter, number>, [all, now]);
  const current = previewKey ? flat.find((f) => keyOf(f) === previewKey) ?? all.find((f) => keyOf(f) === previewKey) ?? null : null;

  const patch = (f: BrowserFile, change: Partial<BrowserFile> | null) =>
    setDesks((ds) => ds.map((d) => d.workspace !== f.workspace ? d : { ...d, files: change === null ? d.files.filter((x) => x.path !== f.path) : d.files.map((x) => (x.path === f.path ? { ...x, ...change } : x)) }));

  const copy = async (url: string, note: string) => {
    try { await navigator.clipboard.writeText(url); setToast(note); } catch { window.prompt("Copy this link", url); }
  };
  const share = async (f: BrowserFile) => {
    if (f.share && shareState(f.share, now).state === "shared") return copy(f.share.url, "Link copied");
    setBusy(keyOf(f));
    try {
      const r = await fetch(`/api/workspaces/${encodeURIComponent(f.workspace)}/shares`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: `storage/${f.path}` }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `sharing failed (${r.status})`);
      const s: BrowserShare = { token: j.token, url: j.url, expiresAt: j.expiresAt ?? null };
      patch(f, { share: s });
      await copy(s.url, `Shared — link copied${s.expiresAt ? ", works for 7 days" : ""}`);
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
    const r = await fetch(`/api/workspaces/${encodeURIComponent(f.workspace)}/shares?token=${encodeURIComponent(f.share.token)}`, { method: "DELETE", headers });
    if (r.ok) { patch(f, { share: null }); setToast("No longer shared"); router.refresh(); } else setToast(`could not stop sharing (${r.status})`);
  };
  // Files into a desk, one after another, then the page reads the store again.
  const uploadTo = async (workspace: string, files: File[]) => {
    const list = files.filter((f) => f.size > 0 || f.name);
    if (!workspace || !list.length) return;
    let ok = 0;
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setUploading({ workspace, done: i, total: list.length, name: file.name });
      try {
        await uploadFile(workspace, tenant, file, relFor(file));
        ok++;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
    }
    setUploading(null);
    setCardsOpen("storage", true, workspace);
    setToast(failed.length ? `${ok} uploaded to ${workspace}; ${failed.length} refused — ${failed[0]}` : `${ok} file${ok === 1 ? "" : "s"} uploaded to ${workspace}`);
    router.refresh();
  };
  const pickFor = (workspace: string) => {
    pendingDesk.current = workspace;
    fileInput.current?.click();
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
      const i = flat.findIndex((f) => keyOf(f) === keyOf(current));
      if (e.key === "Escape") setPreviewKey(null);
      else if (e.key === "ArrowRight" && i >= 0 && i < flat.length - 1) setPreviewKey(keyOf(flat[i + 1]));
      else if (e.key === "ArrowLeft" && i > 0) setPreviewKey(keyOf(flat[i - 1]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, flat]);

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  const actions = (f: BrowserFile, big = false) => {
    const shared = shareState(f.share, now).state === "shared";
    // The design system's buttons, one size down on a row.
    const size = big ? "!gap-1.5 !text-sm" : "!gap-1.5 !px-2 !py-1 !text-xs";
    return (
      <div className={`flex items-center gap-1.5 ${big ? "" : "w-[4.75rem] justify-end xl:w-[11.5rem]"}`} onClick={(e) => e.stopPropagation()}>
        <a href={downloadHref(f)} className={buttonClass("secondary", size)} title="Download">
          <Icon d={I.download} /> <span className={big ? "" : "hidden xl:inline"}>Download</span>
        </a>
        <button
          type="button"
          disabled={!canShare || busy === keyOf(f)}
          onClick={() => void share(f)}
          title={!canShare ? "This install has no public address to share from" : shared ? "Copy the public link" : "Make a public link (7 days) and copy it"}
          className={shared
            ? buttonClass("secondary", `${size} !border-emerald-200 !bg-emerald-50 !text-emerald-800 hover:!bg-emerald-100 disabled:opacity-40`)
            : buttonClass("primary", `${size} disabled:cursor-not-allowed disabled:opacity-40`)}
        >
          <Icon d={shared ? I.link : I.share} /> <span className={big ? "" : "hidden xl:inline"}>{busy === keyOf(f) ? "Sharing…" : shared ? "Copy link" : "Share"}</span>
        </button>
      </div>
    );
  };

  return (
    <div>
      {/* Above the preview panel: a confirmation asked from inside it must
          not open underneath it. */}
      <div className="relative z-[70]">{confirmDialog}</div>
      {toast && <Toast text={toast} onDone={clearToast} />}
      {uploading && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink/95 px-4 py-2 text-sm text-on-ink shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Uploading {uploading.name} to {uploading.workspace} · {uploading.done + 1} of {uploading.total}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void uploadTo(pendingDesk.current, files);
        }}
      />

      {/* Find, and narrow. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-[16rem] flex-1 items-center">
          <Icon d={I.search} className="pointer-events-none absolute left-3 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={single ? "Find a file…" : "Find a file in any desk…"}
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-fg-subtle focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/5"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.filter((x) => x.key === "all" || counts[x.key] > 0).map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setFilter(x.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums transition-colors ${filter === x.key ? "bg-ink text-on-ink" : "bg-surface text-fg-tertiary ring-1 ring-inset ring-line hover:bg-sunken"}`}
            >
              {x.label} <span className={filter === x.key ? "text-gray-300" : "text-fg-subtle"}>{counts[x.key]}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs tabular-nums text-fg-muted">{all.length} file{all.length === 1 ? "" : "s"} · {fmtSize(totalBytes)}</span>
        {!single && shown.length > 1 && <CollapseAll scope="storage" />}
        {toolbarExtra}
        {!single && (workspaces ?? desks.map((d) => d.workspace)).length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen((v) => !v)} className={buttonClass("primary", "!gap-1.5")} aria-expanded={pickerOpen}>
              <Icon d={I.upload} /> Upload
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-xl">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">To which desk</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm">
                  {(workspaces ?? desks.map((d) => d.workspace)).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                <p className="mt-2 text-[11px] text-fg-muted">Any file, up to 512 MB each. Its runs read it at <code className="font-mono">workspace/storage/</code>.</p>
                <button type="button" onClick={() => { setPickerOpen(false); pickFor(target); }} className={buttonClass("primary", "mt-3 w-full !justify-center")}>Choose files…</button>
              </div>
            )}
          </div>
        )}
      </div>

      {shown.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-800">{all.length ? "Nothing matches" : "Nothing stored yet"}</p>
          <p className="mt-1 text-xs text-fg-muted">{all.length ? "Try another word, or clear the filter." : "Upload a file on a desk's Storage page, or let a run write one to storage/."}</p>
        </div>
      )}

      <div className="space-y-4">
        {shown.map((d) => {
          const searching = q.trim() !== "" || filter !== "all";
          const limit = showAll[d.workspace] || searching ? d.files.length : 8;
          const bytes = d.files.reduce((s, f) => s + f.size, 0);
          const sharedN = d.files.filter((f) => shareState(f.share, now).state === "shared").length;
          return (
            <CollapsibleCard
              key={d.workspace}
              id={anchorId("desk", d.workspace)}
              scope="storage"
              item={d.workspace}
              // Collapsed by default where there are many desks; a search
              // opens the ones it found something in. One desk's page has no
              // desk header at all.
              alwaysOpen={single}
              forceOpen={searching}
              inline
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropOn(d.workspace); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(null); }}
              onDrop={(e) => { e.preventDefault(); setDropOn(null); void uploadTo(d.workspace, Array.from(e.dataTransfer.files)); }}
              borderClass={`transition-colors ${dropOn === d.workspace ? "border-sky-400 ring-4 ring-sky-100" : "border-line"}`}
              bodyClassName="border-t border-line-faint"
              before={dropOn === d.workspace && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sky-50/80 text-sm font-medium text-sky-800">Drop to upload to {d.workspace}</div>
              )}
              title={
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-semibold uppercase text-on-ink">{d.workspace[0]}</span>
                  <span className="truncate">{d.workspace}</span>
                </span>
              }
              meta={
                <>
                  <span className="text-xs tabular-nums text-fg-muted">{d.files.length} file{d.files.length === 1 ? "" : "s"} · {fmtSize(bytes)}</span>
                  {sharedN > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">{sharedN} shared</span>}
                </>
              }
              actions={
                <>
                  <button type="button" onClick={() => pickFor(d.workspace)} className={buttonClass("secondary", "!gap-1.5 !px-2 !py-1 !text-xs")} title={`Upload files to ${d.workspace} — or drop them on this card`}>
                    <Icon d={I.upload} /> Upload
                  </button>
                  <Link href={`/dashboard/${d.workspace}/storage${qs}`} className="text-xs font-medium text-fg-muted hover:text-fg">Open desk →</Link>
                </>
              }
            >
              {(
                d.files.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-fg-subtle">No files.</p>
                ) : (
                  <>
                    <div className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_8.5rem_auto] gap-4 border-b border-line-faint bg-sunken/60 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle md:grid">
                      <span>Name</span><span className="text-right">Size</span><span>Modified</span><span>Sharing</span><span className="w-[4.75rem] xl:w-[11.5rem]" />
                    </div>
                    <ul className="divide-y divide-line-faint">
                      {d.files.slice(0, limit).map((f) => {
                        const slash = f.path.lastIndexOf("/");
                        const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
                        const name = f.path.slice(slash + 1);
                        const from = provenance(f.by);
                        return (
                          <li key={f.path}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setPreviewKey(keyOf(f))}
                              onKeyDown={(e) => { if (e.key === "Enter") setPreviewKey(keyOf(f)); }}
                              className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2 transition-colors hover:bg-sunken md:grid-cols-[minmax(0,1fr)_5rem_6rem_8.5rem_auto] ${previewKey === keyOf(f) ? "bg-sky-50/60" : ""}`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <Thumb f={f} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm text-fg"><span className="text-fg-subtle">{dir}</span><span className="font-medium">{name}</span></p>
                                  <p className="truncate text-[11px] text-fg-muted">
                                    {from.kind === "run" ? <>from <span className="font-medium text-fg-tertiary">{from.agent}</span> · run</> : from.kind === "user" ? <>uploaded by {from.who}</> : "stored"}
                                    <span className="md:hidden"> · {fmtSize(f.size)} · {fmtAge(f.updatedAt, now)}</span>
                                  </p>
                                </div>
                              </div>
                              <span className="hidden text-right text-xs tabular-nums text-fg-tertiary md:block">{fmtSize(f.size)}</span>
                              <span className="hidden text-xs text-fg-muted md:block" title={f.updatedAt}>{fmtAge(f.updatedAt, now)}</span>
                              <span className="hidden md:block"><SharePill share={f.share} now={now} /></span>
                              {actions(f)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {d.files.length > limit && (
                      <button type="button" onClick={() => setShowAll((s) => ({ ...s, [d.workspace]: true }))} className="w-full border-t border-line-faint py-2 text-xs font-medium text-fg-muted hover:bg-sunken hover:text-fg">
                        Show all {d.files.length} files
                      </button>
                    )}
                  </>
                )
              )}
            </CollapsibleCard>
          );
        })}
      </div>

      {/* The preview: the file as itself, and what is known about it. */}
      {current && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-[2px]" onClick={() => setPreviewKey(null)}>
          <aside data-preview className="flex h-full w-full max-w-3xl flex-col bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="File preview">
            <header className="flex items-start gap-3 border-b border-line-faint px-5 py-4">
              <Thumb f={current} size="h-11 w-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-fg" title={current.path}>{current.path.split("/").pop()}</p>
                <p className="truncate text-xs text-fg-muted">{current.workspace} · storage/{current.path}</p>
              </div>
              <button type="button" onClick={() => setPreviewKey(null)} className="rounded-md p-1.5 text-fg-subtle hover:bg-muted hover:text-fg-secondary" title="Close (Esc)">
                <Icon d={I.close} />
              </button>
            </header>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-faint bg-sunken/60 px-5 py-2.5 text-xs text-fg-tertiary">
              <span>{fmtSize(current.size)}</span>
              <span title={current.updatedAt}>modified {fmtAge(current.updatedAt, now)}</span>
              {(() => {
                const from = provenance(current.by);
                if (from.kind === "run") return <Link href={runHref(current.workspace, from.runId, tenant)} className="font-medium text-sky-700 hover:underline">from {from.agent} · open the run →</Link>;
                if (from.kind === "user") return <span>uploaded by {from.who}</span>;
                return null;
              })()}
              <SharePill share={current.share} now={now} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted/70 p-4">
              <Preview key={keyOf(current)} f={current} />
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-line-faint px-5 py-3">
              {actions(current, true)}
              {current.share && shareState(current.share, now).state === "shared" && (
                <button type="button" onClick={() => void unshare(current)} className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-tertiary hover:bg-muted">Stop sharing</button>
              )}
              <span className="ml-auto hidden text-[11px] text-fg-subtle sm:inline"><kbd className="rounded border border-line px-1">←</kbd> <kbd className="rounded border border-line px-1">→</kbd> next file · <kbd className="rounded border border-line px-1">esc</kbd> close</span>
              <button type="button" onClick={() => void remove(current)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-red-50 hover:text-red-700">
                <Icon d={I.trash} /> Delete
              </button>
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
            <div className="px-8 pb-8"><Markdown text={fm ? p.text.slice(fm[0].length) : p.text} className="text-[15px] leading-relaxed text-gray-800" /></div>
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
          <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-gray-800">{p.text || "(empty)"}</pre>
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
                <button key={sh.name + i} type="button" onClick={() => setTab(i)} className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${i === tab ? "bg-ink/90 text-on-ink" : "text-fg-tertiary hover:bg-muted"}`}>{sh.name}</button>
              ))}
            </div>
          )}
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-[12px]">
              {head && (
                <thead className="sticky top-0 bg-sunken">
                  <tr>
                    <th className="border-b border-r border-line px-2 py-1.5 text-right font-normal text-fg-subtle">#</th>
                    {Array.from({ length: cols }, (_, c) => <th key={c} className="whitespace-nowrap border-b border-r border-line px-3 py-1.5 text-left font-semibold text-gray-800">{head[c] ?? ""}</th>)}
                  </tr>
                </thead>
              )}
              <tbody>
                {body.map((r, i) => (
                  <tr key={i} className="odd:bg-surface even:bg-sunken/60 hover:bg-sky-50/50">
                    <td className="border-r border-line-faint px-2 py-1 text-right tabular-nums text-fg-subtle">{i + 2}</td>
                    {Array.from({ length: cols }, (_, c) => <td key={c} className="max-w-[24rem] truncate border-r border-line-faint px-3 py-1 text-fg-secondary" title={r[c] ?? ""}>{r[c] ?? ""}</td>)}
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
          {p.note && <p className="border-b border-amber-100 bg-amber-50/60 px-6 py-2 text-xs text-amber-800">{p.note}</p>}
          <article className="space-y-3 px-10 py-10 font-serif text-[15px] leading-relaxed text-gray-800">
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
              <p className="text-[10px] uppercase tracking-wide text-fg-subtle">Slide {i + 1}</p>
              <h3 className="mt-2 text-xl font-semibold text-fg">{sl.title}</h3>
              <ul className="mt-3 space-y-1 text-sm text-fg-secondary">{sl.lines.slice(0, 14).map((l, j) => <li key={j} className="flex gap-2"><span className="text-gray-300">•</span>{l}</li>)}</ul>
            </div>
          ))}
        </div>
      );
    case "archive":
      return (
        <Paper wide>
          <p className="border-b border-line-faint px-4 py-2 text-xs text-fg-muted">{p.entries.length} item{p.entries.length === 1 ? "" : "s"} inside</p>
          <ul className="divide-y divide-gray-50 font-mono text-[12px]">
            {p.entries.map((e) => (
              <li key={e.name} className="flex gap-4 px-4 py-1"><span className="min-w-0 flex-1 truncate text-gray-800">{e.name}</span><span className="shrink-0 tabular-nums text-fg-subtle">{e.name.endsWith("/") ? "" : fmtSize(e.size)}</span></li>
            ))}
          </ul>
          <Cut show={p.truncated} what="the first 2,000 entries" />
        </Paper>
      );
    case "html":
      return (
        <Paper wide>
          <div className="flex items-center gap-1 border-b border-line-faint px-3 py-1.5 text-[11px]">
            <button type="button" onClick={() => setSource(false)} className={`rounded px-2 py-0.5 ${!source ? "bg-muted text-fg" : "text-fg-muted hover:text-gray-800"}`}>Page</button>
            <button type="button" onClick={() => setSource(true)} className={`rounded px-2 py-0.5 ${source ? "bg-muted text-fg" : "text-fg-muted hover:text-gray-800"}`}>Source</button>
            <span className="ml-auto text-fg-subtle">scripts off — shown in a sealed frame</span>
          </div>
          {source ? (
            <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-gray-800">{p.html}</pre>
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
          {p.attachments.length > 0 && <p className="border-b border-line-faint px-6 py-2 text-xs text-fg-muted">📎 {p.attachments.join(" · ")}</p>}
          <pre className="whitespace-pre-wrap break-words px-6 py-5 font-sans text-sm leading-relaxed text-gray-800">{p.body || "(no text body)"}</pre>
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
              {c.lines.map((l, j) => <p key={j} className="truncate text-xs text-fg-tertiary" title={l}>{l}</p>)}
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
                <div className="px-6 py-4"><Markdown text={c.source} className="text-sm text-gray-800" /></div>
              ) : (
                <>
                  <pre className="overflow-auto bg-sunken px-4 py-3 font-mono text-[12px] text-gray-800"><span className="mr-2 select-none text-sky-600">In [{i + 1}]</span>{c.source}</pre>
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
          <p className="text-xs uppercase tracking-wide text-fg-subtle">A saved link</p>
          <a href={p.url} target="_blank" rel="noreferrer noopener" className="max-w-lg break-all text-lg font-medium text-sky-700 underline-offset-2 hover:underline">{p.url}</a>
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
        className="h-[60vh] w-full cursor-grab rounded-lg border border-line bg-slate-50 shadow-sm active:cursor-grabbing"
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
      <a href={downloadHref(f)} className={buttonClass("primary", "!gap-1.5")}>
        <Icon d={I.download} /> Download
      </a>
    </div>
  );
}
