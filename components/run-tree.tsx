"use client";

// The run as one tree (FOL-72 step 5): run → step → model call → tool call,
// a waterfall bar on each line, opened on the first thing that went wrong.
// The same tree GET …/runs/<id>/trace answers and `foldrun report --tree`
// prints (core trace-tree.ts), built here from the run the page already polls.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildTraceTree, failurePath, type TraceSpan } from "@/lib/trace-tree";
import type { RunRecord } from "@/lib/store";
import { CallContent, type CallRun } from "@/components/trace-view";
import { fmtDur } from "@/components/run-timeline";
import { grouped } from "@/components/money";

const TONE: Record<TraceSpan["status"], string> = {
  ok: "bg-emerald-500/70",
  error: "bg-red-500",
  running: "bg-sky-500 animate-pulse",
  waiting: "bg-violet-500",
  skipped: "bg-muted-strong",
  pending: "bg-muted",
};

const ICON: Record<TraceSpan["kind"], string> = { run: "▣", step: "◆", model: "✦", tool: "→", error: "✗" };

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : grouped(n));

function Row({
  span,
  depth,
  open,
  toggle,
  range,
  culprit,
  callRun,
  tenant,
}: {
  span: TraceSpan;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  range: { start: number; width: number };
  /** The deepest span on the way to the failure: highlighted, scrolled to. */
  culprit: string | null;
  callRun: CallRun;
  tenant: string;
}) {
  const [io, setIo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = open.has(span.id);
  const failing = span.id === culprit;
  useEffect(() => {
    // The failure the view opens on is scrolled to, once.
    if (failing) ref.current?.scrollIntoView({ block: "nearest" });
  }, [failing]);
  const dur = span.start !== null && span.end !== null ? Math.max(0, span.end - span.start) : null;
  const left = span.start !== null ? ((span.start - range.start) / range.width) * 100 : 0;
  const width = dur !== null ? Math.max(0.6, (dur / range.width) * 100) : 0;
  const facts = [
    span.kind === "model" && span.tokens ? `${k(span.tokens.input)} in${span.tokens.input && span.tokens.cacheRead ? ` (${Math.round((100 * span.tokens.cacheRead) / span.tokens.input)}% cached)` : ""} · ${k(span.tokens.output)} out` : null,
    span.kind === "step" && span.tokens ? `${k(span.tokens.input)} in · ${k(span.tokens.output)} out` : null,
    span.stop ?? null,
    span.subagent ? `↳ ${span.subagent}` : null,
  ].filter(Boolean);
  return (
    <>
      <div
        ref={ref}
        className={`group grid grid-cols-[minmax(0,1fr)_minmax(6rem,30%)] items-center gap-3 rounded px-1.5 py-0.5 text-xs ${failing ? "bg-danger-soft" : "hover:bg-sunken"}`}
      >
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 14}px` }}>
          {span.children.length > 0 ? (
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(span.id)} className="w-3 shrink-0 text-fg-subtle hover:text-fg">
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={`w-3 shrink-0 text-center ${span.status === "error" ? "text-danger" : "text-fg-subtle"}`}>{ICON[span.kind]}</span>
          <span className={`truncate ${span.kind === "step" || span.kind === "run" ? "font-medium text-fg" : span.status === "error" ? "text-danger" : "text-fg-secondary"}`} title={span.text ?? span.label}>
            {span.kind === "error" ? span.text : span.label}
          </span>
          {facts.length > 0 && <span className="shrink-0 truncate text-[11px] text-fg-subtle">{facts.join(" · ")}</span>}
          {span.kind === "tool" && span.captured && (
            <button type="button" aria-expanded={io} onClick={() => setIo((v) => !v)} className="shrink-0 text-[11px] font-medium text-fg-muted hover:text-fg hover:underline">
              {io ? "hide" : "input / output"}
            </button>
          )}
          {dur !== null && span.kind !== "error" && <span className="ml-auto shrink-0 tabular-nums text-[11px] text-fg-subtle">{fmtDur(dur)}</span>}
        </div>
        <div className="relative h-2.5 rounded-sm bg-sunken">
          {span.start !== null && <div className={`absolute inset-y-0 rounded-sm ${TONE[span.status]}`} style={{ left: `${Math.min(99.4, left)}%`, width: `${Math.min(100 - Math.min(99.4, left), width)}%` }} />}
        </div>
      </div>
      {io && span.call && (
        <div style={{ paddingLeft: `${depth * 14 + 40}px` }} className="pr-2 pb-1">
          <CallContent run={callRun} call={span.call} tenant={tenant} />
        </div>
      )}
      {isOpen && span.children.map((c) => <Row key={c.id} span={c} depth={depth + 1} open={open} toggle={toggle} range={range} culprit={culprit} callRun={callRun} tenant={tenant} />)}
    </>
  );
}

export function RunTree({ run, workspace, tenant, now }: { run: RunRecord; workspace: string; tenant: string; now: number }) {
  const tree = useMemo(() => buildTraceTree(run, now), [run, now]);
  const path = useMemo(() => failurePath(tree), [tree]);
  // Open: the run, every step, and the way to the failure.
  const initial = useMemo(() => new Set(["run", ...tree.children.map((s) => s.id), ...path]), [tree, path]);
  const [touched, setTouched] = useState<Map<string, boolean>>(new Map());
  const open = useMemo(() => {
    const s = new Set(initial);
    for (const [id, v] of touched) {
      if (v) s.add(id);
      else s.delete(id);
    }
    return s;
  }, [initial, touched]);
  const toggle = (id: string) => setTouched((m) => new Map(m).set(id, !open.has(id)));
  const allIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (s: TraceSpan) => {
      if (s.children.length) ids.push(s.id);
      s.children.forEach(walk);
    };
    walk(tree);
    return ids;
  }, [tree]);
  const start = tree.start ?? now;
  const range = { start, width: Math.max(1, (tree.end ?? now) - start) };
  const calls = tree.children.reduce((n, s) => n + s.children.filter((c) => c.kind === "model").length, 0);
  return (
    <section className="rounded-xl border border-line bg-surface p-2 shadow-sm">
      <header className="mb-1 flex items-center gap-2 px-1.5 text-[11px]">
        <span className="font-medium uppercase tracking-wide text-fg-subtle">trace</span>
        <span className="text-fg-subtle">
          {tree.children.length} step{tree.children.length === 1 ? "" : "s"} · {calls} model call{calls === 1 ? "" : "s"}
          {path.length > 0 ? " · opened on what went wrong" : ""}
        </span>
        <button type="button" onClick={() => setTouched(new Map(allIds.map((id) => [id, true])))} className="ml-auto text-fg-muted hover:text-fg hover:underline">
          expand all
        </button>
        <button type="button" onClick={() => setTouched(new Map(allIds.filter((id) => id !== "run").map((id) => [id, false])))} className="text-fg-muted hover:text-fg hover:underline">
          collapse
        </button>
      </header>
      <div className="max-h-[32rem] overflow-auto">
        <Row span={tree} depth={0} open={open} toggle={toggle} range={range} culprit={path.length ? path[path.length - 1]! : null} callRun={{ workspace, runId: run.id }} tenant={tenant} />
      </div>
    </section>
  );
}
