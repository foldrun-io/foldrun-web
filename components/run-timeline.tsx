"use client";

// The shape of a run, drawn: one row per step, a bar from when it started to
// when it finished, tool calls as a strip of smaller spans beneath. Parallel
// steps share a group and their bars overlap in time, which is the whole
// point — a list of forty fan-out instances is unreadable, forty bars are a
// picture. Live runs grow to the right against the clock the panel already
// ticks; nothing here talks to the server.
//
// Timing comes from the record and degrades honestly: a step stamped with
// startedAt/finishedAt is exact; an older step falls back to its first and
// last event; a tool call with a paired completion is a span, one without
// is a tick. Nothing is estimated.
//
// The chart can be zoomed: drag across it to look at a window, pinch or
// ⌘-scroll to zoom about the cursor, scroll sideways to pan, double-click
// for the whole run. A long run compresses an hour of tool calls into a
// smear at full width; the window is how you read the smear.

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunRecord, StepRecord } from "@/lib/store";
import {
  toolSpans, stepSpan, fmtDur, fmtTick, tickEvery, type ToolSpan,
  windowEdges, clampWindow, zoomWindow, panWindow, placeSpan, type Window,
} from "./run-timeline-model";

export { toolSpans, traceEvents, stepSpan, fmtDur } from "./run-timeline-model";

// ---------- drawing ----------

const BAR: Record<string, string> = {
  completed: "bg-green-500/80",
  failed: "bg-red-500/80",
  stopped: "bg-gray-400",
  running: "bg-orange-400 timeline-live",
  "awaiting-approval": "bg-amber-300 timeline-waiting",
  skipped: "bg-muted-strong",
  pending: "bg-muted-strong",
};

function barStatus(step: StepRecord): string {
  return step.skipReason === "run stopped" ? "stopped" : step.status;
}

export function RunTimeline({
  run,
  now,
  onSelect,
}: {
  run: RunRecord;
  /** Wall clock, ticked by the parent while the run is live. */
  now: number;
  onSelect?: (stepIndex: number) => void;
}) {
  const [hover, setHover] = useState<{ step: number; tool?: ToolSpan } | null>(null);

  const model = useMemo(() => {
    const t0 = new Date(run.startedAt).getTime();
    const spans = run.steps.map((s) => stepSpan(s, now));
    const tools = run.steps.map((s) => toolSpans(s));
    const runLive = run.status === "running" || run.status === "awaiting-approval" || run.status === "queued";
    const lastSeen = Math.max(
      t0,
      run.finishedAt ? new Date(run.finishedAt).getTime() : 0,
      ...spans.map((s) => s?.end ?? 0),
      ...tools.flat().map((t) => t.end ?? t.start),
    );
    const tEnd = runLive ? Math.max(now, lastSeen) : lastSeen;
    // Never a zero-width axis: a run that just started still gets a scale.
    const total = Math.max(tEnd - t0, 1000);
    return { t0, total, spans, tools, runLive };
  }, [run, now]);

  const { t0, total, spans, tools, runLive } = model;

  // The window (see the model): null is the whole run. Its rules — clamping,
  // the minimum, the moving end — live in run-timeline-model.ts with tests.
  const [win, setWin] = useState<Window | null>(null);
  const edges = windowEdges(win, total);
  const { from: wFrom, to: wTo } = edges;
  const wLen = wTo - wFrom;
  const setWindow = (from: number, to: number) => setWin(clampWindow(from, to, total));
  const zoomAbout = (factor: number, anchor: number) => setWin(zoomWindow(win, total, factor, anchor));
  const pan = (delta: number) => setWin(panWindow(win, total, delta));
  // The buttons zoom about the live edge while it is in view — that is the
  // part of a running flow you are watching — and about the centre otherwise.
  const zoomStep = (factor: number) => zoomAbout(factor, win === null || win.to == null ? wTo : (wFrom + wTo) / 2);

  const place = (a: number, b: number, floor: number) => placeSpan(a - t0, b - t0, edges, floor);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (((t - t0) - wFrom) / wLen) * 100))}%`;

  const every = tickEvery(wLen);
  const ticks: number[] = [];
  for (let t = Math.ceil(wFrom / every) * every; t <= wTo; t += every) ticks.push(t);
  const tickPos = (t: number) => ((t - wFrom) / wLen) * 100;

  // Wheel is attached by hand: React's is passive, and ⌘-wheel left alone
  // zooms the whole browser page. A plain vertical wheel is the page's —
  // the chart sits in a scrolling page and must not trap it.
  const chartRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      const el = chartRef.current;
      if (!el) return;
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && (win === null || Math.abs(e.deltaX) <= Math.abs(e.deltaY))) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (pinch) {
        const frac = (e.clientX - rect.left) / rect.width;
        const dy = Math.max(-120, Math.min(120, e.deltaY));
        zoomAbout(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.003)), wFrom + frac * wLen);
      } else {
        pan((e.deltaX / rect.width) * wLen);
      }
    };
  });
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag across the chart to pick a window. A press that does not move is
  // still a click on whatever bar it landed on; one that moved swallows the
  // click that follows it, so a brush never also jumps to a step.
  const brushRef = useRef<{ x0: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null); // fractions of the width
  const fracOf = (clientX: number) => {
    const rect = chartRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const totalCost = run.steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const toolCount = tools.reduce((n, t) => n + t.length, 0);

  // The readout under the chart: what is hovered, or the run as a whole.
  let readout: string;
  if (hover) {
    const step = run.steps[hover.step];
    const span = spans[hover.step];
    if (hover.tool) {
      const t = hover.tool;
      readout = `${step.agent} → ${t.name}${t.end != null ? ` · ${fmtDur(t.end - t.start)}` : " · running"}${t.err ? " · error" : ""}`;
    } else {
      const parts = [step.agent + (step.item ? ` · ${step.item}` : ""), barStatus(step)];
      if (span) parts.push(fmtDur(span.end - span.start));
      if (step.model) parts.push(step.model);
      if (step.costUsd != null) parts.push(`$${step.costUsd.toFixed(4)}`);
      if (tools[hover.step].length) parts.push(`${tools[hover.step].length} tool call${tools[hover.step].length === 1 ? "" : "s"}`);
      if ((step.attempts ?? 0) > 1) parts.push(`attempt ${step.attempts}`);
      if (step.skipReason) parts.push(step.skipReason);
      readout = parts.join(" · ");
    }
  } else {
    const parts = [`${run.steps.length} step${run.steps.length === 1 ? "" : "s"}`, fmtDur(total)];
    if (toolCount) parts.push(`${toolCount} tool call${toolCount === 1 ? "" : "s"}`);
    if (totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`);
    if (win) parts.unshift(`${fmtTick(wFrom)} – ${win.to == null ? "now" : fmtTick(wTo)}`);
    readout = parts.join(" · ");
  }

  const tall = run.steps.length > 18;
  // Bars glide as the live scale grows under them — the 500ms matches the
  // clock's tick, so the slide is continuous. Under a chosen window the
  // scale moves by hand, and a hand wants the picture now, not in 500ms.
  const glide = win === null ? "transition-[width,left] duration-500 ease-linear" : "";

  return (
    <div className="rounded-xl border border-line bg-surface">
      <style>{`
        @keyframes timeline-slide { from { background-position: 0 0 } to { background-position: 28px 0 } }
        .timeline-live {
          background-image: repeating-linear-gradient(-55deg, rgba(255,255,255,.35) 0 6px, transparent 6px 14px);
          animation: timeline-slide 1s linear infinite;
        }
        .timeline-waiting {
          background-image: repeating-linear-gradient(-55deg, rgba(255,255,255,.55) 0 4px, transparent 4px 9px);
        }
      `}</style>

      {/* axis */}
      <div className="grid grid-cols-[11rem_1fr] border-b border-line-faint text-[10px] text-fg-subtle">
        <div className="px-3 py-1.5 font-medium uppercase tracking-wide">Timeline</div>
        <div className="relative h-6 pr-3">
          {/* A label within a few percent of either edge would clip; the
              grid line still marks the tick. The run's own zero always shows. */}
          {ticks.filter((t) => tickPos(t) < 96 && (tickPos(t) > 3 || t === 0)).map((t) => (
            <span
              key={t}
              className="absolute top-1.5 -translate-x-1/2 tabular-nums"
              style={{ left: `${tickPos(t)}%` }}
            >
              {t === 0 ? "0" : fmtTick(t)}
            </span>
          ))}
        </div>
      </div>

      {/* rows */}
      <div className={`grid grid-cols-[11rem_1fr] ${tall ? "max-h-[28rem] overflow-y-auto" : ""}`}>
        <div className="border-r border-line-faint">
          {run.steps.map((step, i) => {
            const firstOfGroup = i === 0 || run.steps[i - 1].group !== step.group;
            const parallel = !firstOfGroup;
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHover({ step: i })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(i)}
                className={`flex h-8 w-full items-center gap-1.5 px-3 text-left text-xs transition-colors hover:bg-sunken ${
                  hover?.step === i ? "bg-sunken" : ""
                }`}
                title={step.instruction || step.agent}
              >
                <span
                  className="w-4 shrink-0 tabular-nums text-gray-300"
                  title={firstOfGroup ? `group ${step.group}` : `runs in parallel with the step above (group ${step.group})`}
                >
                  {firstOfGroup ? step.group : "‖"}
                </span>
                <span className={`min-w-0 truncate ${parallel ? "text-fg-tertiary" : "font-medium text-gray-800"}`}>
                  {step.agent}
                  {step.item && <span className="text-fg-subtle"> · {step.item}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div
          ref={chartRef}
          className="relative touch-pan-y pr-3"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            brushRef.current = { x0: e.clientX, moved: false };
          }}
          onPointerMove={(e) => {
            const b = brushRef.current;
            if (!b) return;
            if (!b.moved) {
              if (Math.abs(e.clientX - b.x0) < 4) return;
              b.moved = true;
              chartRef.current?.setPointerCapture(e.pointerId);
            }
            setBrush({ a: fracOf(b.x0), b: fracOf(e.clientX) });
          }}
          onPointerUp={(e) => {
            const b = brushRef.current;
            brushRef.current = null;
            setBrush(null);
            if (!b?.moved) return;
            swallowClick.current = true;
            const [a, z] = [fracOf(b.x0), fracOf(e.clientX)].sort((x, y) => x - y);
            const rect = chartRef.current!.getBoundingClientRect();
            if ((z - a) * rect.width < 6) return; // a twitch, not a selection
            setWindow(wFrom + a * wLen, wFrom + z * wLen);
          }}
          onPointerCancel={() => {
            brushRef.current = null;
            setBrush(null);
          }}
          onClickCapture={(e) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }}
          onDoubleClick={() => setWin(null)}
        >
          {/* grid lines */}
          {ticks.map((t) => (
            <span
              key={t}
              className="pointer-events-none absolute inset-y-0 border-l border-line-faint"
              style={{ left: `${tickPos(t)}%` }}
            />
          ))}
          {/* the live edge */}
          {runLive && now - t0 >= wFrom && now - t0 <= wTo && (
            <span className="pointer-events-none absolute inset-y-0 z-10 border-l border-orange-400/70" style={{ left: pct(now) }} />
          )}
          {/* the window being chosen */}
          {brush && (
            <span
              className="pointer-events-none absolute inset-y-0 z-20 border-x border-blue-400/70 bg-blue-500/10"
              style={{ left: `${Math.min(brush.a, brush.b) * 100}%`, width: `${Math.abs(brush.b - brush.a) * 100}%` }}
            />
          )}

          {run.steps.map((step, i) => {
            const span = spans[i];
            const status = barStatus(step);
            const stepTools = tools[i];
            const bar = span ? place(span.start, span.end, 0.35) : null;
            return (
              <div
                key={i}
                className={`relative h-8 ${hover?.step === i ? "bg-sunken" : ""}`}
                onMouseEnter={() => setHover({ step: i })}
                onMouseLeave={() => setHover(null)}
              >
                {span ? (
                  <>
                    {bar && (
                      <button
                        type="button"
                        onClick={() => onSelect?.(i)}
                        className={`absolute top-1.5 h-3 rounded-sm ${glide} ${BAR[status] ?? "bg-gray-300"} ${
                          status === "skipped" || status === "pending" ? "border border-dashed border-line-strong bg-transparent" : ""
                        }`}
                        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                        aria-label={`${step.agent}, ${status}`}
                      />
                    )}
                    {/* tools: a strip beneath the bar, each call a span */}
                    {stepTools.map((t, j) => {
                      const unfinished = t.end == null && !span.live;
                      const end = t.end ?? (span.live ? now : t.start);
                      const at = place(t.start, end, 0);
                      if (!at) return null;
                      return (
                        <button
                          type="button"
                          key={j}
                          onMouseEnter={(e) => {
                            e.stopPropagation();
                            setHover({ step: i, tool: t });
                          }}
                          onMouseLeave={() => setHover({ step: i })}
                          onClick={() => onSelect?.(i)}
                          className={`absolute top-[1.375rem] h-1.5 rounded-[2px] ${glide} ${
                            t.err ? "bg-red-400" : unfinished ? "bg-blue-300" : "bg-blue-400/80"
                          } hover:bg-blue-600`}
                          style={{
                            // The 2px floor is in pixels, so the right-edge
                            // guard is too: never past the column's edge.
                            left: `min(${at.left}%, calc(100% - 2px))`,
                            width: unfinished ? "2px" : `${at.width}%`,
                            minWidth: 2,
                          }}
                          aria-label={t.name}
                        />
                      );
                    })}
                  </>
                ) : (
                  <span className="absolute top-3.5 right-0 text-[10px] text-gray-300">{status}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line-faint px-3 py-1.5 text-[11px] text-fg-muted">
        <span className="min-w-0 flex-1 truncate tabular-nums">{readout}</span>
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-subtle">
          <button
            type="button"
            onClick={() => zoomStep(1 / 1.6)}
            disabled={win === null}
            className="h-5 w-5 rounded hover:bg-muted hover:text-fg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomStep(1.6)}
            className="h-5 w-5 rounded hover:bg-muted hover:text-fg-secondary"
            title="Zoom in — or drag across the chart, or pinch"
            aria-label="Zoom in"
          >
            +
          </button>
          {win && (
            <button
              type="button"
              onClick={() => setWin(null)}
              className="ml-0.5 rounded px-1.5 hover:bg-muted hover:text-fg-secondary"
              title="Show the whole run (double-click the chart)"
            >
              whole run
            </button>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-fg-subtle">
          <span className="inline-block h-2 w-3 rounded-sm bg-green-500/80" /> step
          <span className="inline-block h-1.5 w-3 rounded-[2px] bg-blue-400/80" /> tool
          <span className="inline-block h-2 w-3 rounded-sm bg-amber-300 timeline-waiting" /> waiting
        </span>
      </div>
    </div>
  );
}
