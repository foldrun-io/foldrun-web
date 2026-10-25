"use client";

// The step's browser, as a small theater: a browser-shaped frame with the
// address the page is on, a stage that shows it live while the step runs
// (with the last minute kept to rewind), and a filmstrip of what the step
// recorded — each call's video and each screenshot — to play in the same
// stage afterwards. One place to watch a browser agent, during and after.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIVE_POLL_MS, REWIND_FRAMES, frameAge, mediaFiles, mediaKind, recordingLabel } from "@/components/run-browser-model";
import { useViewerTime } from "@/components/viewer-time";

interface Frame {
  src: string;
  url: string;
  at: string;
  ended: boolean;
  engine: string;
}
type File = { agent: string; path: string };
type Shown = { kind: "live" } | { kind: "file"; file: File };

const hostOf = (u: string) => {
  try { return new URL(u).host; } catch { return u; }
};
/** When a recording started, in the zone the viewer chose. */
function RecTime({ at }: { at: Date }) {
  const text = useViewerTime(at.toISOString(), { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return text ? <span className="block text-[9px] tabular-nums text-fg-subtle">{text}</span> : null;
}

/** Frames of the step's browser while it runs: newest last, a minute kept. */
function useLiveFrames(workspace: string, runId: string, agent: string, active: boolean) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const kept = useRef<Frame[]>([]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/live?agent=${encodeURIComponent(agent)}`, { cache: "no-store" });
        if (r.status === 200) {
          const at = r.headers.get("x-live-at") ?? "";
          const last = kept.current[kept.current.length - 1];
          const ended = r.headers.get("x-live-ended") === "1";
          if (!last || last.at !== at || last.ended !== ended) {
            const blob = await r.blob();
            if (stopped) return;
            let url = r.headers.get("x-live-url") ?? "";
            try { url = decodeURIComponent(url); } catch { /* as sent */ }
            const next = [...kept.current, { src: URL.createObjectURL(blob), url, at, ended, engine: r.headers.get("x-live-engine") ?? "" }];
            while (next.length > REWIND_FRAMES) URL.revokeObjectURL(next.shift()!.src);
            kept.current = next;
            setFrames(next);
          }
        }
      } catch {
        // a dropped poll is the next poll's job
      }
      if (!stopped && active) timer = setTimeout(tick, LIVE_POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspace, runId, agent, active]);
  useEffect(() => () => kept.current.forEach((f) => URL.revokeObjectURL(f.src)), []);
  return frames;
}

export function BrowserTheater({
  workspace,
  runId,
  agent,
  active,
  files,
  hrefOf,
}: {
  workspace: string;
  runId: string;
  agent: string;
  active: boolean;
  files: File[];
  hrefOf: (f: File) => string;
}) {
  const frames = useLiveFrames(workspace, runId, agent, active);
  const media = useMemo(() => mediaFiles(files), [files]);
  // Newest recording last: by the time in its name, else as listed.
  const videos = media
    .filter((f) => mediaKind(f.path) === "video")
    .map((f, i) => ({ f, t: recordingLabel(f.path).at?.getTime() ?? -1, i }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.f);
  const [shown, setShown] = useState<Shown | null>(null);
  const [rewind, setRewind] = useState<number | null>(null); // index into frames, null = newest
  const [theater, setTheater] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!theater) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTheater(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater]);

  const latest = frames[frames.length - 1] ?? null;
  const live = active && !!latest && !latest.ended;
  // What the stage shows unless someone picked a tile: live while it is
  // live, else the latest recording, else the last frame seen.
  const current: Shown | null = shown ?? (live ? { kind: "live" } : videos[0] ? { kind: "file", file: videos[videos.length - 1] } : latest ? { kind: "live" } : media[0] ? { kind: "file", file: media[0] } : null);
  const pick = useCallback((s: Shown) => { setShown(s); setRewind(null); }, []);
  if (!current) return null;

  const frame = current.kind === "live" ? (rewind !== null ? frames[rewind] : latest) : null;
  const address = current.kind === "live" ? frame?.url ?? "" : current.file.path;
  const file = current.kind === "file" ? current.file : null;
  const behind = rewind !== null && latest && frames[rewind] ? Math.round((new Date(latest.at).getTime() - new Date(frames[rewind].at).getTime()) / 1000) : 0;

  const stage = (
    <div className={`palette-fixed relative w-full overflow-hidden bg-neutral-950 ${theater ? "h-full" : "aspect-[16/10]"}`}>
      {frame && (
        // eslint-disable-next-line @next/next/no-img-element -- a blob of a live frame
        <img src={frame.src} alt={`What ${agent}'s browser shows`} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {file && mediaKind(file.path) === "video" && (
        <video key={file.path} controls autoPlay={!!shown} playsInline preload="metadata" src={hrefOf(file)} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {file && mediaKind(file.path) === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- an archived screenshot, served as itself
        <img src={hrefOf(file)} alt={file.path} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {current.kind === "live" && frame && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow ${live && rewind === null ? "bg-red-600 text-white" : "bg-black/70 text-gray-200"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live && rewind === null ? "animate-pulse bg-surface" : "bg-gray-400"}`} />
            {live ? (rewind === null ? "live" : `${behind}s behind`) : "last seen"}
          </span>
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] tabular-nums text-gray-200">{frameAge(frame.at, now)}</span>
        </div>
      )}
    </div>
  );

  const tiles = (
    <div className="flex gap-2 overflow-x-auto px-3 py-2.5">
      {latest && (
        <button
          type="button"
          onClick={() => pick({ kind: "live" })}
          className={`group relative h-20 w-36 shrink-0 overflow-hidden rounded-md border ${current.kind === "live" ? "border-red-500 ring-2 ring-red-500/30" : "border-gray-700 hover:border-gray-500"}`}
          title={live ? "Watch live" : "The last frame seen"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- live frame thumbnail */}
          <img src={latest.src} alt="" className="h-full w-full object-cover object-top opacity-80 group-hover:opacity-100" />
          <span className={`absolute bottom-1 left-1 rounded px-1 text-[9px] font-semibold uppercase ${live ? "bg-red-600 text-white" : "bg-black/70 text-gray-200"}`}>{live ? "live" : "last"}</span>
        </button>
      )}
      {media.map((f) => {
        const isVideo = mediaKind(f.path) === "video";
        const label = isVideo ? recordingLabel(f.path) : null;
        const on = current.kind === "file" && current.file.path === f.path && current.file.agent === f.agent;
        return (
          <button
            key={`${f.agent}/${f.path}`}
            type="button"
            onClick={() => pick({ kind: "file", file: f })}
            className={`group relative h-20 w-36 shrink-0 overflow-hidden rounded-md border bg-neutral-900 ${on ? "border-sky-400 ring-2 ring-sky-400/30" : "border-gray-700 hover:border-gray-500"}`}
            title={f.path}
          >
            {isVideo ? (
              <video src={`${hrefOf(f)}#t=0.5`} muted preload="metadata" playsInline className="pointer-events-none h-full w-full object-cover object-top opacity-80 group-hover:opacity-100" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- archived screenshot thumbnail
              <img src={hrefOf(f)} alt="" loading="lazy" className="h-full w-full object-cover object-top opacity-80 group-hover:opacity-100" />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1.5 pb-1 pt-4 text-left leading-tight">
              <span className="block truncate text-[10px] font-medium text-gray-100">{isVideo ? `▶ ${label!.site}` : `▣ ${f.path.split("/").pop()}`}</span>
              {isVideo && label!.at && <RecTime at={label!.at} />}
            </span>
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div className={`palette-fixed overflow-hidden border border-gray-800 bg-neutral-900 shadow-sm ${theater ? "flex h-full flex-col rounded-lg" : "mb-3 rounded-lg"}`}>
      {/* The window: traffic lights, the address, what is known about it. */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-neutral-800 px-3 py-2">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-neutral-900 px-2.5 py-1 font-mono text-[11px] text-gray-300" title={address}>
          <span className="text-fg-muted">{address.startsWith("https://") ? "🔒" : current.kind === "file" ? "▶" : "○"}</span>
          <span className="truncate">{current.kind === "live" ? address : `${agent} · ${address}`}</span>
          {current.kind === "live" && address && <span className="ml-auto hidden shrink-0 text-fg-muted sm:inline">{hostOf(address)}</span>}
        </div>
        {latest?.engine && <span className="hidden rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300 sm:inline">{latest.engine}</span>}
        {videos.length > 0 && <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-200" title="recordings of this step">● rec {videos.length}</span>}
        <button type="button" onClick={() => setTheater((t) => !t)} className="rounded px-1.5 py-0.5 text-[11px] text-gray-300 hover:bg-neutral-700 hover:text-white" title={theater ? "Close (Esc)" : "Watch full screen"}>
          {theater ? "✕ close" : "⤢ theater"}
        </button>
        {file && (
          <a href={hrefOf(file)} target="_blank" rel="noreferrer" className="rounded px-1.5 py-0.5 text-[11px] text-gray-300 hover:bg-neutral-700 hover:text-white" title="Open the file on its own">↗</a>
        )}
      </div>
      <div className={theater ? "min-h-0 flex-1" : ""}>{stage}</div>
      {/* Rewind: the minute of frames this page has seen, while live. */}
      {current.kind === "live" && frames.length > 1 && (
        <div className="flex items-center gap-3 border-t border-gray-800 px-3 py-2 text-[11px] text-fg-subtle">
          <span className="shrink-0">rewind</span>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={rewind ?? frames.length - 1}
            onChange={(e) => { const v = Number(e.target.value); setRewind(v === frames.length - 1 ? null : v); }}
            className="h-1 flex-1 cursor-pointer accent-red-500"
            aria-label="Rewind the live view"
          />
          <span className="w-24 shrink-0 text-right tabular-nums">{rewind === null ? `${frames.length} frames` : `${behind}s behind`}</span>
          {rewind !== null && (
            <button type="button" onClick={() => setRewind(null)} className="shrink-0 rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-500">
              {live ? "back to live" : "latest"}
            </button>
          )}
        </div>
      )}
      {media.length > 0 && <div className="border-t border-gray-800">{tiles}</div>}
    </div>
  );

  if (theater) {
    return (
      <>
        <div className="mb-3 flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-fg-subtle">showing in theater — Esc to bring it back</div>
        <div className="fixed inset-0 z-50 bg-black/85 p-4 backdrop-blur-sm md:p-8" onClick={(e) => { if (e.target === e.currentTarget) setTheater(false); }}>
          {body}
        </div>
      </>
    );
  }
  return body;
}
