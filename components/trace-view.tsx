"use client";

// The trace, readable: each line marked for what it is, filters for the
// kind you are looking for, verify as a verdict, long lines one click from
// whole, and the whole trace one click from full height.

import { useEffect, useMemo, useState, type Ref, type UIEvent } from "react";
import { Markdown } from "@/components/markdown";
import { classify, counts, type TraceKind, type TraceLine } from "@/components/trace-model";
import { fmtDur } from "@/components/run-timeline";
import { hookBadge, HOOK_TONE } from "@/components/hooks-model";
import { grouped } from "@/components/money";

const FILTERS: { key: TraceKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "agent", label: "Agent" },
  { key: "tool", label: "Tools" },
  { key: "verify", label: "Verify" },
  { key: "error", label: "Errors" },
  { key: "system", label: "System" },
];

const MARK: Record<TraceKind, { icon: string; tone: string }> = {
  agent: { icon: "◆", tone: "text-fg-subtle" },
  tool: { icon: "→", tone: "text-sky-600" },
  verify: { icon: "✓", tone: "text-emerald-600" },
  error: { icon: "✗", tone: "text-red-600" },
  system: { icon: "·", tone: "text-gray-300" },
};

/** A recorded call's input and output, fetched when opened (FOL-54 step 4). */
export function CallContent({ run, call, tenant }: { run: CallRun; call: string; tenant: string }) {
  const [state, setState] = useState<{ input?: string; output?: string; inputChars?: number; outputChars?: number; inputCut?: boolean; outputCut?: boolean } | string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/${encodeURIComponent(run.workspace)}/runs/${encodeURIComponent(run.runId)}/calls/${encodeURIComponent(call)}`, { headers: { "x-foldrun-tenant": tenant } })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { call?: object; error?: string };
        if (live) setState(r.ok && body.call ? body.call : body.error ?? `${r.status}`);
      })
      .catch((err) => live && setState(String(err)));
    return () => {
      live = false;
    };
  }, [run.workspace, run.runId, call, tenant]);
  if (state === null) return <p className="mt-1 text-[11px] text-fg-subtle">loading…</p>;
  if (typeof state === "string") return <p className="mt-1 text-[11px] text-danger">{state}</p>;
  const part = (label: string, text: string | undefined, whole: number | undefined, cut: boolean | undefined) =>
    text === undefined ? null : (
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          {label}
          {cut && whole !== undefined && whole > text.length ? ` · the first ${grouped(text.length)} of ${grouped(whole)} characters` : ""}
        </p>
        <pre className="mt-0.5 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-line-faint bg-sunken p-1.5 font-mono text-[11px] text-fg-secondary">{text || "(empty)"}</pre>
      </div>
    );
  return (
    <div className="mt-1 space-y-1.5">
      {part("input", state.input, state.inputChars, state.inputCut)}
      {part("output", state.output, state.outputChars, state.outputCut)}
      {state.input === undefined && state.output === undefined && <p className="text-[11px] text-fg-subtle">nothing recorded</p>}
    </div>
  );
}

/** The run a trace belongs to, so a recorded call can be read (FOL-54). */
export interface CallRun {
  workspace: string;
  runId: string;
}

function Row({ line, callRun, tenant }: { line: TraceLine; callRun?: CallRun; tenant: string }) {
  const [open, setOpen] = useState(false);
  const [io, setIo] = useState(false);
  const long = line.text.length > 180 || line.text.includes("\n");
  const mark = line.kind === "verify" && line.ok === false ? { icon: "✗", tone: "text-red-600" } : MARK[line.kind];
  return (
    <div className={`group flex gap-2.5 rounded px-1.5 py-1 ${line.kind === "error" || (line.kind === "verify" && !line.ok) ? "bg-red-50/60" : "hover:bg-sunken"}`}>
      <span className={`w-3 shrink-0 select-none text-center text-xs leading-5 ${mark.tone}`}>{mark.icon}</span>
      {line.subagent && (
        // A sub-agent's call, made on this step's behalf: indented under the
        // step and named, so its work reads apart from the parent's.
        <span className="ml-3 shrink-0 self-start rounded bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200" title="made by a sub-agent (subagents:)">
          ↳ {line.subagent}
        </span>
      )}
      {line.hook && (() => {
        // A hook's line: named and toned by what it did, so a deny or a
        // rewrite reads at a glance rather than as one more trace line.
        const b = hookBadge(line.hook);
        return (
          <span className={`shrink-0 self-start rounded px-1.5 py-px text-[10px] font-medium ring-1 ring-inset ${HOOK_TONE[b.tone]}`} title={`hook ${line.hook.hook} on ${line.hook.event}`}>
            ⚑ {b.label}
          </span>
        );
      })()}
      <div className="min-w-0 flex-1">
        {line.kind === "agent" ? (
          <Markdown text={line.text} className="text-sm text-gray-800" />
        ) : line.kind === "verify" ? (
          <p className="text-[13px] leading-5">
            <span className={`mr-2 rounded px-1.5 py-px text-[10px] font-semibold uppercase ring-1 ring-inset ${line.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{line.ok ? "verified" : "verify failed"}</span>
            <span className="font-mono text-[12px] text-fg-tertiary">{line.text.replace(/^verify\s*/i, "")}</span>
          </p>
        ) : line.tool ? (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
              <span className={`text-[13px] font-medium ${line.kind === "error" ? "text-red-700" : "text-sky-800"}`}>{line.tool.name}</span>
              {line.tool.args && <span className={`ml-1.5 font-mono text-[11.5px] text-fg-muted ${open ? "whitespace-pre-wrap break-all" : "line-clamp-1 break-all"}`}>{line.tool.args}</span>}
            </button>
            {line.call && callRun && (
              <>
                <button type="button" aria-expanded={io} onClick={() => setIo((v) => !v)} className="text-[11px] font-medium text-fg-muted hover:text-fg hover:underline">
                  {io ? "hide input / output" : "input / output"}
                </button>
                {io && <CallContent run={callRun} call={line.call} tenant={tenant} />}
              </>
            )}
          </>
        ) : (
          <button type="button" onClick={() => long && setOpen((v) => !v)} className={`block w-full text-left font-mono text-[11.5px] leading-5 ${line.kind === "error" ? "text-red-700" : "text-fg-muted"} ${long ? "cursor-pointer" : "cursor-text"}`}>
            <span className={open || !long ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}>{line.text}</span>
          </button>
        )}
      </div>
      {line.durationMs != null && <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-fg-subtle">{fmtDur(line.durationMs)}</span>}
    </div>
  );
}

export function TraceView({
  events,
  running,
  boxRef,
  onScroll,
  callRun,
  tenant = "default",
}: {
  events: { type: string; text: string; err?: boolean; durationMs?: number; subagent?: string; hook?: { hook: string; did: string; event: string; tool?: string }; call?: string; captured?: boolean }[];
  /** The run, so a recorded call's content can be read (FOL-54 step 4). */
  callRun?: CallRun;
  tenant?: string;
  running: boolean;
  boxRef: Ref<HTMLDivElement>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
}) {
  // Keyed by place in the whole trace, so a row's open state stays with its
  // line when a filter hides the ones around it.
  const lines = useMemo(() => events.map((e, idx) => ({ ...classify(e), idx })), [events]);
  const n = counts(lines);
  const [filter, setFilter] = useState<TraceKind | "all">("all");
  const [tall, setTall] = useState(false);
  const shown = filter === "all" ? lines : lines.filter((l) => l.kind === filter || (filter === "error" && l.kind === "verify" && l.ok === false));
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">trace</span>
        {FILTERS.filter((f) => f.key === "all" || n[f.key] > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${filter === f.key ? "bg-ink text-on-ink" : f.key === "error" ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-muted text-fg-tertiary hover:bg-muted-strong"}`}
          >
            {f.label} {n[f.key]}
          </button>
        ))}
        <button type="button" onClick={() => setTall((v) => !v)} className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-muted hover:text-fg">
          {tall ? "↑ compact" : "↕ full height"}
        </button>
      </div>
      <div ref={boxRef} onScroll={onScroll} className={`${tall ? "" : "max-h-80"} space-y-0.5 overflow-auto rounded-lg border border-line-faint bg-surface p-1.5`}>
        {shown.length === 0 && <p className="px-2 py-3 text-xs text-fg-subtle">Nothing of that kind in this step.</p>}
        {shown.map((l) => <Row key={l.idx} line={l} callRun={callRun} tenant={tenant} />)}
        {running && (
          <p className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-sky-700">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
            working…
          </p>
        )}
      </div>
    </div>
  );
}
