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
import { Segmented } from "@/components/kit/segmented";
import { Chip, Tag } from "@/components/kit/page";

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
  tool: { icon: "→", tone: "text-info" },
  verify: { icon: "✓", tone: "text-success" },
  error: { icon: "✗", tone: "text-danger" },
  system: { icon: "·", tone: "text-fg-subtle" },
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
  if (state === null) return <p className="mt-1 text-xs text-fg-muted">loading…</p>;
  if (typeof state === "string") return <p className="mt-1 text-xs text-danger">{state}</p>;
  const part = (label: string, text: string | undefined, whole: number | undefined, cut: boolean | undefined) =>
    text === undefined ? null : (
      <div>
        <p className="text-xs font-medium text-fg-muted">
          {label === "input" ? "Input" : label === "output" ? "Output" : label}
          {cut && whole !== undefined && whole > text.length ? ` · the first ${grouped(text.length)} of ${grouped(whole)} characters` : ""}
        </p>
        <pre className="mt-0.5 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-sunken p-2 font-mono text-[11px] text-fg-secondary">{text || "(empty)"}</pre>
      </div>
    );
  return (
    <div className="mt-1 space-y-1.5">
      {part("input", state.input, state.inputChars, state.inputCut)}
      {part("output", state.output, state.outputChars, state.outputCut)}
      {state.input === undefined && state.output === undefined && <p className="text-xs text-fg-muted">nothing recorded</p>}
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
  const mark = line.kind === "verify" && line.ok === false ? { icon: "✗", tone: "text-danger" } : MARK[line.kind];
  return (
    <div className={`group flex gap-2.5 rounded px-1.5 py-1 ${line.kind === "error" || (line.kind === "verify" && !line.ok) ? "bg-danger-soft" : "hover:bg-sunken"}`}>
      <span className={`w-3 shrink-0 select-none text-center text-xs leading-5 ${mark.tone}`}>{mark.icon}</span>
      {line.subagent && (
        // A sub-agent's call, made on this step's behalf: indented under the
        // step and named, so its work reads apart from the parent's.
        <Tag className="ml-3 h-5 self-start" hint="made by a sub-agent (subagents:)">
          ↳ {line.subagent}
        </Tag>
      )}
      {line.hook && (() => {
        // A hook's line: named and toned by what it did, so a deny or a
        // rewrite reads at a glance rather than as one more trace line.
        const b = hookBadge(line.hook);
        return (
          <Chip tone={HOOK_TONE[b.tone]} className="h-5 self-start" hint={`hook ${line.hook.hook} on ${line.hook.event}`}>
            ⚑ {b.label}
          </Chip>
        );
      })()}
      <div className="min-w-0 flex-1">
        {line.kind === "agent" ? (
          <Markdown text={line.text} className="text-sm text-fg" />
        ) : line.kind === "verify" ? (
          <p className="text-[13px] leading-5">
            <Chip tone={line.ok ? "good" : "bad"} className="mr-2 h-5">{line.ok ? "verified" : "verify failed"}</Chip>
            <span className="font-mono text-[12px] text-fg-tertiary">{line.text.replace(/^verify\s*/i, "")}</span>
          </p>
        ) : line.tool ? (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
              <span className={`text-[13px] font-medium ${line.kind === "error" ? "text-danger" : "text-info"}`}>{line.tool.name}</span>
              {line.tool.args && <span className={`ml-1.5 font-mono text-[11.5px] text-fg-muted ${open ? "whitespace-pre-wrap break-all" : "line-clamp-1 break-all"}`}>{line.tool.args}</span>}
            </button>
            {line.call && callRun && (
              <>
                <button type="button" aria-expanded={io} onClick={() => setIo((v) => !v)} className="text-xs font-medium text-fg-muted hover:text-fg hover:underline">
                  {io ? "hide input / output" : "input / output"}
                </button>
                {io && <CallContent run={callRun} call={line.call} tenant={tenant} />}
              </>
            )}
          </>
        ) : (
          <button type="button" onClick={() => long && setOpen((v) => !v)} className={`block w-full text-left font-mono text-[11.5px] leading-5 ${line.kind === "error" ? "text-danger" : "text-fg-muted"} ${long ? "cursor-pointer" : "cursor-text"}`}>
            <span className={open || !long ? "whitespace-pre-wrap break-words" : "line-clamp-2 break-words"}>{line.text}</span>
          </button>
        )}
      </div>
      {line.durationMs != null && <span className="shrink-0 pt-0.5 text-xs tabular-nums text-fg-muted">{fmtDur(line.durationMs)}</span>}
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
        <span className="mr-1 text-[13px] font-medium text-fg-secondary">Trace</span>
        <Segmented
          size="sm"
          label="Show"
          value={filter}
          onChange={(k) => setFilter(k as TraceKind | "all")}
          items={FILTERS.filter((f) => f.key === "all" || n[f.key] > 0).map((f) => ({ key: f.key, label: f.label, count: n[f.key] }))}
        />
        <button type="button" onClick={() => setTall((v) => !v)} className="ml-auto rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-muted hover:text-fg">
          {tall ? "↑ compact" : "↕ full height"}
        </button>
      </div>
      <div ref={boxRef} onScroll={onScroll} className={`${tall ? "" : "max-h-80"} space-y-0.5 overflow-auto rounded-lg border border-line bg-surface p-1.5`}>
        {shown.length === 0 && <p className="px-2 py-3 text-xs text-fg-subtle">Nothing of that kind in this step.</p>}
        {shown.map((l) => <Row key={l.idx} line={l} callRun={callRun} tenant={tenant} />)}
        {running && (
          <p className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-info">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-info" />
            working…
          </p>
        )}
      </div>
    </div>
  );
}
