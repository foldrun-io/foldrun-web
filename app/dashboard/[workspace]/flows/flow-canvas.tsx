"use client";

// The flow canvas: the same flow the list board shows, drawn left to right —
// the trigger, then one column per group, parallel steps stacked, each step
// with its agent's team hung beneath it.
//
// The layout is derived from the markdown on every render
// (components/flow-canvas-model.ts). Nothing about positions is saved: a
// dragged node snaps to a valid place and the MARKDOWN is written, or the
// drop is refused with a reason and the node goes back. Every write is a
// small request whose edit is core's (flow-patterns.ts) — a pattern into the
// flow file, a team change into an agent file — then the page re-renders
// from the file.
//
// Over that drawing: the run (a live one followed over its stream, or one
// picked from the run strip) coloured onto each step, the newest finished
// run's status/time/cost on idle nodes, a menu per step (run from here, test
// alone, pause before, duplicate, copy, delete), undo/redo of every flow
// edit made here, multi-select, a command palette (Cmd+K) with keyboard
// shortcuts, a minimap, and parallel groups folded into one summary node.
// Every one of those either writes the markdown or is a view choice that is
// never saved; none keeps positions or a side file.

import "@xyflow/react/dist/style.css";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  Controls,
  ControlButton,
  MiniMap,
  ViewportPortal,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import type { FlowStep } from "@/lib/store";
import { Badge, buttonClass, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { InlineEditor } from "@/components/inline-editor";
import { humanSchedule } from "@/components/schedule-human";
import { ExpandableTitle } from "@/components/expandable";
import {
  buildCanvas,
  dropTarget,
  describeDrop,
  planMove,
  planMoveMany,
  runStepsToNodes,
  pickRuns,
  stepElapsed,
  humanSecs,
  stepsMarkdown,
  looksLikeSteps,
  recordEdit,
  planUndo,
  planRedo,
  emptyHistory,
  fitViewport,
  COL_GAP,
  NODE_W,
  type AgentTeam,
  type CanvasWarning,
  type CanvasNode,
  type CanvasEdge,
  type DropTarget,
  type StepNodeData,
  type SummaryNodeData,
  type StepRunView,
  type StepRunStatus,
  type RunLite,
  type History,
  type Chip,
} from "@/components/flow-canvas-model";
import { useRunOverlay } from "./use-run-overlay";
import { FIND_EVENT } from "@/components/find";
import { StepOptionsEditor } from "./step-options";
import { STALE_FLOW } from "@/components/flow-write";
import { removalImpact } from "@/lib/step-removal";
import { TriggerEditor } from "./trigger-editor";
import { InstructionEditor } from "./flow-board";

// ---------- palette ----------

type Pattern =
  | "chain" | "parallel" | "router" | "fanout" | "loop" | "approve" | "ask" | "wait" | "rescue" | "workers" | "consult" | "subflow";

type Payload = { kind: "agent"; name: string } | { kind: "pattern"; pattern: Pattern };

const PATTERNS: { pattern: Pattern; label: string; hint: string; where: "gap" | "column" | "step" | "dock" }[] = [
  { pattern: "chain", label: "Chain", hint: "a new step after the one before — drop between columns", where: "gap" },
  { pattern: "parallel", label: "Parallel", hint: "run beside a step — drop onto a column", where: "column" },
  { pattern: "router", label: "Router", hint: "a triage step, then case:/else: branches", where: "gap" },
  { pattern: "fanout", label: "Fan-out", hint: "each: once per line, item or CSV row — onto a step", where: "step" },
  { pattern: "loop", label: "Evaluator loop", hint: "loop: until the critic says so — onto a step", where: "step" },
  { pattern: "approve", label: "Approval gate", hint: "a person approves first (!) — onto a step", where: "step" },
  { pattern: "ask", label: "Ask a person before", hint: "ask: a question at the gate — onto a step", where: "step" },
  { pattern: "wait", label: "Wait", hint: "wait: 30m, or for an event — onto a step", where: "step" },
  { pattern: "rescue", label: "Rescue", hint: "on-fail: another agent takes over — onto a step", where: "step" },
  { pattern: "workers", label: "Orchestrator + workers", hint: "onto a step's sub-agents dock", where: "dock" },
  { pattern: "consult", label: "Consult", hint: "onto a step's consults dock", where: "dock" },
];

// ---------- the form every prompt uses ----------

type Field =
  | { name: string; label: string; type: "text" | "textarea"; placeholder?: string; required?: boolean; initial?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; initial?: string };

interface Ask {
  title: string;
  body?: ReactNode;
  fields: Field[];
  submit: string;
  resolve: (v: Record<string, string> | null) => void;
}

function FormDialog({ ask }: { ask: Ask }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ask.fields.map((f) => [f.name, f.initial ?? ""])),
  );
  const missing = ask.fields.some((f) => f.required && !values[f.name]?.trim());
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={() => ask.resolve(null)}
      role="presentation"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-ask-title"
        className="w-full max-w-md space-y-3 rounded-xl border border-line bg-surface p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && ask.resolve(null)}
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing) ask.resolve(values);
        }}
      >
        <h2 id="canvas-ask-title" className="text-sm font-semibold text-fg">{ask.title}</h2>
        {ask.body && <div className="text-xs leading-relaxed text-fg-muted">{ask.body}</div>}
        {ask.fields.map((f, i) => (
          <label key={f.name} className="block">
            <span className={FIELD_LABEL_CLASS}>{f.label}</span>
            {f.type === "select" ? (
              <select
                autoFocus={i === 0}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={selectClass("w-full")}
              >
                {!f.required && <option value="">—</option>}
                {f.required && !values[f.name] && <option value="">Choose…</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                autoFocus={i === 0}
                rows={2}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={inputClass("text-sm")}
              />
            ) : (
              <input
                autoFocus={i === 0}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={inputClass()}
              />
            )}
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => ask.resolve(null)} className={buttonClass("secondary")}>Cancel</button>
          <button type="submit" disabled={missing} className={buttonClass("primary")}>{ask.submit}</button>
        </div>
      </form>
    </div>
  );
}


// ---------- node components ----------

interface Ctx {
  payload: () => Payload | null;
  dropOnStep: (index: number, zone: "body" | "sub" | "consult") => void;
  hover: (id: string | null) => void;
  hovered: string | null;
  toggleAsk: (index: number) => void;
  addToDock: (index: number, dock: "sub" | "consult") => void;
  removeChild: (parent: number, kind: "sub" | "consult", name: string) => void;
  removeStep: (index: number) => void;
  openTrigger: () => void;
  openMenu: (index: number, at: { x: number; y: number }) => void;
  unfold: (group: number) => void;
}
const CanvasCtx = createContext<Ctx | null>(null);
const useCtx = () => useContext(CanvasCtx)!;

const HIDDEN_HANDLE = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, border: 0, pointerEvents: "none" as const };

const CHIP_TONE: Record<Chip["tone"], string> = {
  default: "bg-muted text-fg-secondary",
  warning: "bg-orange-100 text-orange-800",
  info: "bg-blue-50 text-blue-800",
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

// ---------- run status, drawn ----------

type RunMode = "watch" | "last";

const STATUS_WORD: Record<StepRunStatus, string> = {
  pending: "pending",
  running: "running",
  completed: "done",
  failed: "failed",
  skipped: "skipped",
  "awaiting-approval": "waiting for you",
};
const STATUS_DOT: Record<StepRunStatus, string> = {
  pending: "bg-gray-300",
  running: "bg-sky-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-gray-300",
  "awaiting-approval": "bg-amber-500",
};
/** A watched run paints the node; the last run only labels it. */
const STATUS_NODE: Record<StepRunStatus, string> = {
  pending: "opacity-75",
  running: "!border-sky-500 ring-2 ring-sky-200",
  completed: "!border-emerald-500 bg-emerald-50/50",
  failed: "!border-red-500 bg-red-50/60",
  skipped: "border-dashed opacity-60",
  "awaiting-approval": "!border-amber-500 ring-2 ring-amber-200 bg-amber-50/60",
};
const STATUS_HEX: Record<StepRunStatus, string> = {
  pending: "var(--color-gray-300)",
  running: "var(--color-sky-500)",
  completed: "var(--color-emerald-500)",
  failed: "var(--color-red-500)",
  skipped: "var(--color-gray-200)",
  "awaiting-approval": "var(--color-amber-500)",
};

const money = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

/** The strip above a step: its status in the run, how long, what it cost. */
function RunStrip({ v, mode, now }: { v: StepRunView; mode: RunMode; now: number }) {
  const secs = stepElapsed(v, now);
  const tip = [
    `${mode === "watch" ? "This run" : "Last run"}: ${STATUS_WORD[v.status]}`,
    v.carried ? "carried from an earlier run" : null,
    v.skipReason ?? null,
    v.extras.length ? `also ran: ${v.extras.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = `inline-flex h-4 items-center gap-1 rounded px-1 text-[10px] font-medium leading-none ${
    mode === "watch" ? "bg-surface text-fg-secondary shadow-sm ring-1 ring-line" : "bg-muted/90 text-fg-muted"
  }`;
  return (
    <div className="pointer-events-auto absolute bottom-full left-0 mb-1 flex max-w-full items-center gap-1" title={tip} data-run-strip={v.status}>
      <span className={chip}>
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[v.status]}`} />
        {mode === "last" ? `last: ${STATUS_WORD[v.status]}` : STATUS_WORD[v.status]}
      </span>
      {secs != null && <span className={`${chip} tabular-nums`}>{humanSecs(secs)}</span>}
      {v.costUsd != null && v.costUsd > 0 && <span className={`${chip} tabular-nums`}>{money(v.costUsd)}</span>}
      {v.instances && (
        <span className={chip} title={`${v.instances.done} of ${v.instances.total} items done${v.instances.failed ? `, ${v.instances.failed} failed` : ""}`}>
          {v.instances.done}/{v.instances.total}
        </span>
      )}
      {v.extras.length > 0 && <span className={chip}>+{v.extras.length}</span>}
    </div>
  );
}

type RunData = { run: StepRunView | null; runMode: RunMode | null; now: number };
type StepRF = Node<StepNodeData & { h: number } & RunData, "step">;
type SummaryRF = Node<SummaryNodeData & { h: number; runs: (StepRunView | null)[]; runMode: RunMode | null }, "summary">;
type ChildRF = Node<{ name: string; parent: number; owner: string; missing: boolean; problem: string | null; kind: "sub" | "consult" | "rescuer" }, "child">;
type TriggerRF = Node<{ trigger: string; schedule: string | null }, "trigger">;

function acceptDrag(e: DragEvent, ok: boolean) {
  if (!ok) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "copy";
}

function StepNode({ id, data, selected }: NodeProps<StepRF>) {
  const ctx = useCtx();
  const s = data.step;
  const name = s.subflow ? `flow: ${s.subflow}` : s.agent;
  const errors = data.problems.filter((p) => p.level === "error").length;
  const zone = (z: "body" | "sub" | "consult") => ({
    onDragOver: (e: DragEvent) => {
      const p = ctx.payload();
      const ok = !!p && (z === "body"
        ? p.kind === "agent" || (p.kind === "pattern" && ["fanout", "loop", "approve", "ask", "wait", "rescue", "parallel"].includes(p.pattern))
        : p.kind === "agent" || (p.kind === "pattern" && p.pattern === (z === "sub" ? "workers" : "consult")));
      acceptDrag(e, ok);
      if (ok) ctx.hover(`${id}:${z}`);
    },
    onDragLeave: () => ctx.hover(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.hover(null);
      ctx.dropOnStep(data.index, z);
    },
  });
  const lit = (z: string) => ctx.hovered === `${id}:${z}`;
  const paint = data.run && data.runMode === "watch" ? STATUS_NODE[data.run.status] : "";
  return (
    <div
      {...zone("body")}
      style={{ width: NODE_W, height: data.h }}
      data-step={data.index}
      data-run-status={data.run?.status ?? undefined}
      className={`group/step relative rounded-lg border bg-surface px-2.5 py-1.5 text-left shadow-sm transition-shadow ${
        s.subflow ? "border-dashed border-emerald-500" : errors ? "border-red-400" : "border-line-strong"
      } ${paint} ${selected ? "!ring-2 !ring-gray-900" : ""} ${lit("body") ? "ring-2 ring-sky-500" : ""}`}
    >
      {data.run && data.runMode && <RunStrip v={data.run} mode={data.runMode} now={data.now} />}
      {/* Fan-out: the step runs once per item, so it is drawn as a stack. */}
      {data.fanOut && (
        <>
          <span aria-hidden className="absolute inset-0 -z-10 translate-x-1.5 translate-y-1.5 rounded-lg border border-line-strong bg-surface" />
          <span aria-hidden className="absolute inset-0 -z-20 translate-x-3 translate-y-3 rounded-lg border border-line bg-surface" />
        </>
      )}
      <Handle type="target" position={Position.Left} id="in" style={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Right} id="out" style={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Top} id="loop-out" style={{ ...HIDDEN_HANDLE, left: "70%" }} />
      <Handle type="target" position={Position.Top} id="loop-in" style={{ ...HIDDEN_HANDLE, left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="team" style={{ ...HIDDEN_HANDLE, left: 20 }} />

      <div className="flex h-6 items-center gap-1.5">
        <span className="font-mono text-[10px] text-fg-subtle">{data.column + 1}</span>
        <span className={`min-w-0 truncate text-sm font-medium ${s.subflow ? "text-emerald-700" : "text-fg"}`} title={name}>
          {name}
        </span>
        {data.missing && <span className="rounded bg-red-100 px-1 text-[10px] font-medium text-red-800">not found</span>}
        {data.model && !s.subflow && (
          <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] text-fg-tertiary" title={s.model ? "this step's model" : "the agent's model"}>
            {data.model}
          </span>
        )}
        {/* The step's menu: on hover, on keyboard focus, always on the
            selected step — right-click opens the same menu. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            ctx.openMenu(data.index, { x: r.right, y: r.bottom + 2 });
          }}
          aria-label={`Actions for step ${data.column + 1} · ${name}`}
          aria-haspopup="menu"
          title="Run from here, test alone, pause before, duplicate, copy, delete"
          className={`nodrag shrink-0 rounded px-1 text-sm leading-none text-fg-subtle hover:bg-muted hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-gray-500 group-hover/step:opacity-100 ${
            data.model && !s.subflow ? "" : "ml-auto"
          } ${selected ? "opacity-100" : "opacity-0"}`}
        >
          ⋯
        </button>
        {/* Delete: on hover, on keyboard focus, and always on the selected
            step — Delete/Backspace does the same. Confirmed first. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ctx.removeStep(data.index);
          }}
          aria-label={`Delete step ${data.column + 1} · ${name}`}
          title={`Delete this step from the flow (Delete key)${s.subflow ? "" : ` — agents/${s.agent}/agent.md stays`}`}
          className={`nodrag shrink-0 rounded px-1 text-sm leading-none text-fg-subtle hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-red-500 group-hover/step:opacity-100 ${
            selected ? "opacity-100" : "opacity-0"
          }`}
        >
          ×
        </button>
      </div>
      {s.instruction && (
        <p className="line-clamp-2 h-8 text-[11px] leading-4 text-fg-muted" title={s.instruction}>
          {s.instruction}
        </p>
      )}
      {data.chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {data.chips.map((c) => (
            <span key={c.label} title={c.title ?? c.label} className={`inline-flex h-[18px] max-w-full items-center truncate rounded px-1.5 text-[10.5px] font-medium ${CHIP_TONE[c.tone]}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {!s.subflow && (
        <div className="mt-1 flex h-[22px] items-center gap-1.5 text-[10.5px] text-fg-muted">
          <span>{data.toolCount} tool{data.toolCount === 1 ? "" : "s"}</span>
          {data.agent?.effort && <span>· {data.agent.effort}</span>}
          <button
            type="button"
            onClick={() => ctx.toggleAsk(data.index)}
            disabled={!data.agent}
            className={`nodrag ml-auto rounded px-1.5 py-px font-medium ${
              data.mayAsk ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "border border-dashed border-line-strong text-fg-subtle hover:text-fg-secondary"
            }`}
            title={data.mayAsk ? "tools includes ask — this agent may ask you mid-step. Click to take it away." : "Let this agent ask you mid-step (adds ask to its tools:)"}
          >
            {data.mayAsk ? "may ask you" : "can ask me: off"}
          </button>
        </div>
      )}
      {!s.subflow && (
        <div className="mt-1 grid h-6 grid-cols-2 gap-1">
          {(["sub", "consult"] as const).map((z) => (
            <button
              key={z}
              type="button"
              {...zone(z)}
              onClick={() => ctx.addToDock(data.index, z)}
              disabled={!data.agent}
              className={`nodrag rounded border border-dashed text-[10.5px] ${
                lit(z) ? "border-sky-500 bg-sky-50 text-sky-800" : "border-line-strong text-fg-subtle hover:border-gray-400 hover:text-fg-secondary"
              }`}
              title={z === "sub" ? "Drop an agent here to delegate jobs to it (subagents:)" : "Drop an agent here to consult it for answers (agents:)"}
            >
              + {z === "sub" ? "sub-agent" : "consult"}
            </button>
          ))}
        </div>
      )}
      {data.problems.map((p, i) => (
        <p
          key={i}
          title={p.message}
          className={`mt-0.5 flex h-4 items-center gap-1 truncate text-[10.5px] font-medium ${p.level === "error" ? "text-red-700" : "text-amber-700"}`}
        >
          <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${p.level === "error" ? "bg-red-500" : "bg-amber-500"}`} />
          <span className="truncate">{p.message}</span>
        </p>
      ))}
    </div>
  );
}

/** The worst of several steps' states: what a folded group says. */
function worst(views: (StepRunView | null)[]): StepRunStatus | null {
  const order: StepRunStatus[] = ["failed", "awaiting-approval", "running", "pending", "completed", "skipped"];
  const have = views.filter((v): v is StepRunView => !!v).map((v) => v.status);
  return order.find((s) => have.includes(s)) ?? null;
}

/** A parallel group folded shut — a view choice, nothing written. */
function SummaryNode({ data, selected }: NodeProps<SummaryRF>) {
  const ctx = useCtx();
  const status = worst(data.runs);
  const cost = data.runs.reduce((n, v) => n + (v?.costUsd ?? 0), 0);
  return (
    <div
      style={{ width: NODE_W, height: data.h }}
      data-summary={data.group}
      className={`relative flex flex-col rounded-lg border-2 border-double bg-surface px-2.5 py-1.5 text-left shadow-sm ${
        data.errors ? "border-red-400" : "border-gray-400"
      } ${status && data.runMode === "watch" ? STATUS_NODE[status] : ""} ${selected ? "ring-2 ring-gray-900" : ""}`}
    >
      {status && data.runMode && (
        <div className="absolute bottom-full left-0 mb-1 flex gap-1">
          <span className="inline-flex h-4 items-center gap-1 rounded bg-surface px-1 text-[10px] font-medium text-fg-secondary shadow-sm ring-1 ring-line">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {data.runMode === "last" ? `last: ${STATUS_WORD[status]}` : STATUS_WORD[status]}
          </span>
          {cost > 0 && <span className="inline-flex h-4 items-center rounded bg-surface px-1 text-[10px] font-medium tabular-nums text-fg-secondary shadow-sm ring-1 ring-line">{money(cost)}</span>}
        </div>
      )}
      <Handle type="target" position={Position.Left} id="in" style={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Right} id="out" style={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Top} id="loop-out" style={{ ...HIDDEN_HANDLE, left: "70%" }} />
      <Handle type="target" position={Position.Top} id="loop-in" style={{ ...HIDDEN_HANDLE, left: "30%" }} />
      <div className="flex h-6 items-center gap-1.5">
        <span className="font-mono text-[10px] text-fg-subtle">{data.column + 1}</span>
        <span className="text-sm font-medium text-fg">{data.steps.length} steps in parallel</span>
        <button
          type="button"
          onClick={() => ctx.unfold(data.group)}
          className="nodrag ml-auto rounded border border-line-strong px-1.5 text-[10.5px] text-fg-tertiary hover:bg-sunken hover:text-fg"
          title="Show every step of this group again"
        >
          Unfold
        </button>
      </div>
      <p className="line-clamp-2 text-[11px] leading-4 text-fg-muted" title={data.names.join(", ")}>
        {data.names.join(" · ")}
      </p>
      {data.errors > 0 && <p className="mt-auto text-[10.5px] font-medium text-red-700">{data.errors} problem{data.errors === 1 ? "" : "s"} inside — unfold to see</p>}
    </div>
  );
}

function ChildNode({ data, width, height }: NodeProps<ChildRF>) {
  const ctx = useCtx();
  const style =
    data.kind === "rescuer"
      ? "border-dashed border-red-400 text-red-800"
      : data.problem || data.missing
        ? "border-red-400 text-red-800"
        : data.kind === "sub"
          ? "border-gray-900 text-fg"
          : "border-dotted border-gray-500 text-fg-secondary";
  return (
    <div
      style={{ width, height }}
      title={data.problem ?? (data.kind === "sub" ? `sub-agent of ${data.owner}` : data.kind === "consult" ? `${data.owner} consults ${data.name}` : `takes over when the step fails`)}
      className={`flex items-center gap-1 rounded-md border bg-surface px-1.5 text-[11px] shadow-sm ${style}`}
    >
      <Handle type="target" position={Position.Left} id="in" style={HIDDEN_HANDLE} />
      <span className="shrink-0 text-[9.5px] text-fg-subtle">{data.kind === "sub" ? "sub-agent" : data.kind === "consult" ? "consults" : "on fail →"}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{data.name}</span>
      {data.kind !== "rescuer" && (
        <button
          type="button"
          aria-label={`Remove ${data.name} from ${data.owner}'s ${data.kind === "sub" ? "sub-agents" : "consults"}`}
          title={`Remove ${data.name} from ${data.owner}'s ${data.kind === "sub" ? "subagents:" : "agents:"}`}
          onClick={() => ctx.removeChild(data.parent, data.kind as "sub" | "consult", data.name)}
          className="nodrag rounded px-1 text-fg-muted hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-red-500"
        >
          ×
        </button>
      )}
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<TriggerRF>) {
  const ctx = useCtx();
  const human = data.schedule ? (humanSchedule(data.schedule) ?? data.schedule) : null;
  return (
    <button
      type="button"
      onClick={ctx.openTrigger}
      style={{ width: 150, height: 56 }}
      className={`nodrag flex flex-col items-start justify-center rounded-full border border-line-strong bg-sunken px-4 text-left shadow-sm hover:border-gray-500 ${selected ? "ring-2 ring-gray-900" : ""}`}
      title="Change how this flow starts"
    >
      <Handle type="source" position={Position.Right} id="out" style={HIDDEN_HANDLE} />
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">starts</span>
      <span className="truncate text-sm font-medium text-fg">{data.trigger}</span>
      {human && <span className="w-full truncate text-[10px] text-fg-muted">{human}</span>}
    </button>
  );
}

/** The evaluator loop: an arc over the top, back to the previous group. */
function LoopEdge({ id, sourceX, sourceY, targetX, targetY, label, style, markerEnd }: EdgeProps) {
  const lift = 30 + Math.min(16, Math.abs(sourceX - targetX) * 0.04);
  const top = Math.min(sourceY, targetY) - lift;
  const path =
    Math.abs(sourceX - targetX) < 1
      ? `M ${sourceX} ${sourceY} C ${sourceX + 40} ${top}, ${targetX - 40} ${top}, ${targetX} ${targetY}`
      : `M ${sourceX} ${sourceY} C ${sourceX} ${top}, ${targetX} ${top}, ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${top + lift * 0.22}px)` }}
            className="nodrag nopan pointer-events-none absolute rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-900"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { step: StepNode, summary: SummaryNode, child: ChildNode, trigger: TriggerNode };
const edgeTypes = { loop: LoopEdge };

// The graph page's vocabulary: a delegate is a solid, heavier agent-colour
// line; a consult is dotted. Sequence is the flow's green.
const AGENT = "var(--color-gray-900)";
const FLOWC = "var(--color-emerald-600)";
function edgeStyle(e: CanvasEdge): Partial<Edge> {
  const label = e.label;
  const labelProps = label
    ? { label, labelStyle: { fontSize: 10, fontWeight: 500 }, labelBgPadding: [3, 1] as [number, number], labelBgBorderRadius: 3 }
    : {};
  switch (e.kind) {
    case "seq":
      return { type: "default", style: { stroke: FLOWC, strokeWidth: 1.3 }, markerEnd: { type: MarkerType.ArrowClosed, color: FLOWC, width: 14, height: 14 } };
    case "case":
    case "else":
      return {
        type: "default",
        ...labelProps,
        labelBgStyle: { fill: "var(--color-blue-50)" },
        style: { stroke: "var(--color-blue-600)", strokeWidth: 1.3 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-blue-600)", width: 14, height: 14 },
      };
    case "loop":
      return { type: "loop", label, style: { stroke: "var(--color-amber-600)", strokeWidth: 1.4 }, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-amber-600)", width: 14, height: 14 } };
    case "onfail":
      return { type: "smoothstep", style: { stroke: "var(--color-red-600)", strokeWidth: 1.4, strokeDasharray: "5 4" } };
    // Down the spine, then right into the child. The edge's label ("sub-agent",
    // "consults", "on fail") is drawn where the line lands, at the start of
    // the child — on a shared spine a mid-edge label would sit on its sibling.
    case "delegate":
      return { type: "smoothstep", style: { stroke: AGENT, strokeWidth: 2 } };
    case "consult":
      return { type: "smoothstep", style: { stroke: AGENT, strokeWidth: 1.4, strokeDasharray: "1 3" } };
  }
}

function toRF(n: CanvasNode): Node {
  if (n.kind === "trigger") return { id: n.id, type: "trigger", position: { x: n.x, y: n.y }, data: n.data, draggable: false, width: n.w, height: n.h };
  if (n.kind === "summary")
    return {
      id: n.id,
      type: "summary",
      position: { x: n.x, y: n.y },
      data: { ...n.data, h: n.h, runs: [], runMode: null },
      draggable: false,
      width: n.w,
      height: n.h,
      ariaLabel: `Step ${n.data.column + 1}: ${n.data.steps.length} steps in parallel, folded`,
    };
  if (n.kind === "step")
    return {
      id: n.id,
      type: "step",
      position: { x: n.x, y: n.y },
      data: { ...n.data, h: n.h, run: null, runMode: null, now: 0 },
      draggable: true,
      width: n.w,
      height: n.h,
      ariaLabel: `Step ${n.data.column + 1}: ${n.data.step.subflow ? `flow ${n.data.step.subflow}` : n.data.step.agent}. Enter to select, then use the panel below.`,
    };
  return { id: n.id, type: "child", position: { x: n.x, y: n.y }, data: { ...n.data, kind: n.kind }, draggable: false, width: n.w, height: n.h, selectable: false };
}

function toRFEdge(e: CanvasEdge): Edge {
  const handles =
    e.kind === "loop"
      ? { sourceHandle: "loop-out", targetHandle: "loop-in" }
      : e.kind === "delegate" || e.kind === "consult" || e.kind === "onfail"
        ? { sourceHandle: "team", targetHandle: "in" }
        : { sourceHandle: "out", targetHandle: "in" };
  return { id: e.id, source: e.source, target: e.target, ...handles, ...edgeStyle(e), focusable: false, selectable: false };
}

// ---------- keyboard ----------

/** Several canvases share a page (one per flow card): shortcuts go to the
 *  one last touched, never to all of them. */
/** And copied steps, for the menu's Paste — the system clipboard is
 *  written too, but reading it back needs a permission prompt. */
const shared: { active: string | null; copied: string | null } = { active: null, copied: null };
const touch = (id: string) => {
  shared.active = id;
};
const release = (id: string) => {
  if (shared.active === id) shared.active = null;
};
const keep = (text: string) => {
  shared.copied = text;
};

const MINIMAP_KEY = "foldrun.canvas.minimap";
function readMinimap(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMinimap(on: boolean) {
  try {
    localStorage.setItem(MINIMAP_KEY, on ? "1" : "0");
  } catch {
    // remembered for this page only
  }
}

/** Typing somewhere: an input, a select, a code editor. Shortcuts stand down. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return true;
  return !!el.closest?.(".cm-editor, [role='dialog']");
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const SHORTCUTS: [string, string][] = [
  [`${MOD}K`, "command palette — add a step or pattern, run, go to a step"],
  [`${MOD}Z`, "undo the last edit made on this canvas"],
  [`Shift+${MOD}Z`, "redo"],
  [`${MOD}D`, "duplicate the selected step"],
  [`${MOD}C / ${MOD}V`, "copy the selected steps' markdown / paste steps after the selection"],
  ["Delete", "delete the selected steps (asks first)"],
  ["Shift+click, Shift+drag", "select several steps; drag them together to move them"],
  ["M", "show or hide the minimap"],
  ["Esc", "clear the selection, close a menu"],
  ["?", "this sheet"],
];

// ---------- the canvas ----------

export interface FlowCanvasProps {
  workspace: string;
  tenant: string;
  flow: string;
  file: string;
  trigger: string;
  schedule: string | null;
  timezone: string | null;
  steps: FlowStep[];
  agents: AgentTeam[];
  knownFlows: string[];
  warnings: CanvasWarning[];
  usedBy: Record<string, string[]>;
  /** The flow file as it reads now — what copy slices and undo starts from. */
  raw?: string;
  /** This flow's recent runs, newest first, cut down (liteRun). */
  runs?: RunLite[];
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

type Command = { id: string; label: string; hint?: string; keys?: string; disabled?: string | false; run: () => void };

function Canvas({ workspace, tenant, flow, file, trigger, schedule, timezone, steps, agents, knownFlows, warnings, usedBy, raw = "", runs = [] }: FlowCanvasProps) {
  const router = useRouter();
  const rf = useReactFlow();
  const me = useId();
  const [confirmRaw, confirmDialog] = useConfirm();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [panel, setPanel] = useState<"options" | "instruction" | "agent" | "trigger" | null>(null);
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [palette, setPalette] = useState<Command[] | null>(null);
  const [sheet, setSheet] = useState(false);
  const [minimap, setMinimap] = useState(false);
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [picked, setPicked] = useState<string | null>(null); // a run id, or "none"
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistoryState] = useState<History>(emptyHistory);
  const historyRef = useRef(history);
  const setHistory = (next: History | ((h: History) => History)) => {
    const v = typeof next === "function" ? next(historyRef.current) : next;
    historyRef.current = v;
    setHistoryState(v);
  };
  const dialogOpen = useRef(false);
  const payloadRef = useRef<Payload | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // Full screen: the canvas pane fills the screen (browser Fullscreen API)
  // and the drawing is fitted to it; Esc or the button leaves.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === paneRef.current && paneRef.current !== null;
      setFull(on);
      moved.current = false;
      // Fit after the browser has resized the pane.
      requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ padding: 0.06, duration: 150 })));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [rf]);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void paneRef.current?.requestFullscreen?.();
  };
  // The whole flow in view, by width AND height — React Flow's own fit
  // button was clamped by minZoom and fought the width-only first fit, so
  // on a wide flow it appeared to do nothing (owner, 1 Oct).
  const fitAll = () => {
    moved.current = true;
    void rf.fitView({ padding: 0.06, duration: 200 });
  };
  const [paneW, setPaneW] = useState(0);

  // The minimap choice lives in this browser; read after mount, so the
  // server render and the first client render agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser-only preference, read once after mount
    setMinimap(readMinimap());
  }, []);

  const confirm: typeof confirmRaw = async (o) => {
    dialogOpen.current = true;
    try {
      return await confirmRaw(o);
    } finally {
      dialogOpen.current = false;
    }
  };

  const teams = useMemo(() => Object.fromEntries(agents.map((a) => [a.name, a])), [agents]);
  const layout = useMemo(
    () => buildCanvas({ trigger, schedule, steps, agents: teams, flows: knownFlows, warnings, collapsed }),
    [trigger, schedule, steps, teams, knownFlows, warnings, collapsed],
  );

  // --- the run drawn over the nodes ---
  const { live, last } = pickRuns(runs);
  const watchId = picked === "none" ? null : (picked ?? live?.id ?? null);
  const known = runs.find((r) => r.id === watchId) ?? null;
  const { run: watched, link } = useRunOverlay(workspace, tenant, watchId, known);
  const shown = watched ?? (watchId ? null : last);
  const runMode: RunMode | null = watched ? "watch" : shown ? "last" : null;
  const views = useMemo(() => (shown ? runStepsToNodes(steps, shown.steps) : null), [shown, steps]);
  const lastViews = useMemo(() => (last ? runStepsToNodes(steps, last.steps) : null), [last, steps]);
  const ticking = !!views?.some((v) => v?.status === "running");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const baseNodes = useMemo(() => layout.nodes.map(toRF), [layout]);
  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        const out: Node = {
          ...n,
          selected: selection.includes(n.id),
          ...(drag[n.id] ? { position: drag[n.id] } : {}),
        };
        if (n.type === "step") {
          const i = (n.data as StepNodeData).index;
          out.data = { ...n.data, run: views?.[i] ?? null, runMode: views?.[i] ? runMode : null, now };
        } else if (n.type === "summary") {
          const idx = (n.data as SummaryNodeData).steps;
          out.data = { ...n.data, runs: idx.map((i) => views?.[i] ?? null), runMode };
        }
        return out;
      }),
    [baseNodes, selection, drag, views, runMode, now],
  );
  const edges = useMemo(() => layout.edges.map(toRFEdge), [layout]);
  const agentNames = agents.map((a) => a.name);
  const otherFlows = knownFlows.filter((f) => f !== flow);
  // A selected node the drawing no longer has (a group folded or unfolded,
  // a step deleted) is not selected: React Flow never says it went.
  const drawn = new Set(layout.nodes.map((n) => n.id));
  const selectedSteps = selection.filter((id) => id.startsWith("step-") && drawn.has(id)).map((id) => Number(id.slice(5))).filter((i) => steps[i]).sort((a, b) => a - b);
  const selectedStep = selectedSteps.length === 1 ? selectedSteps[0] : null;
  const selectOnly = (ids: string[]) => setSelection(ids);

  // --- the opening view: fitted once the pane has a real width (a card
  // body mounts hidden), again when the drawing changes — until the person
  // pans or zooms, after which the view is theirs. ---
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPaneW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = useMemo(() => fitViewport(layout, paneW || 960), [layout, paneW]);
  const shape = `${layout.width}x${layout.height}:${layout.nodes.length}`;
  useEffect(() => {
    if (!paneW || moved.current) return;
    void rf.setViewport({ x: fit.x, y: fit.y, zoom: fit.zoom });
    // `shape` stands for the layout: re-fit when the drawing changes, not on every overlay tick.
  }, [paneW, shape]); // eslint-disable-line react-hooks/exhaustive-deps

  const prompt = (a: Omit<Ask, "resolve">) =>
    new Promise<Record<string, string> | null>((resolve) =>
      setAsk({
        ...a,
        resolve: (v) => {
          setAsk(null);
          resolve(v);
        },
      }),
    );

  const flash = (s: string) => {
    setStatus(s);
    setTimeout(() => setStatus((x) => (x === s ? null : x)), 2500);
  };

  const send = async (url: string, method: string, body: unknown) => {
    setStatus("saving…");
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && url === flowUrl) throw new Error(STALE_FLOW);
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      // A flow write answers with the file either side of it: undo's record.
      if (typeof data.before === "string" && typeof data.text === "string") setHistory((h) => recordEdit(h, data.before, data.text));
      flash("saved");
      router.refresh();
      return true;
    } catch (err) {
      setStatus(`not saved — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  const flowUrl = `/api/workspaces/${workspace}/flows/${flow}`;
  // Every flow write carries `expect`: the text this drawing's step indices
  // were read from. The route refuses it (409) when the file has moved on —
  // another tab, the editor, our own last write not yet refreshed — instead
  // of applying the indices to whichever steps have them now.
  const flowPatch = (body: Record<string, unknown>) => send(flowUrl, "PATCH", raw ? { ...body, expect: raw } : body);
  const flowEdit = (edit: unknown) => flowPatch({ edit });
  const agentEdit = (agent: string, body: unknown) => send(`/api/workspaces/${workspace}/agents/${agent}`, "PATCH", body);

  // The file changed under us (another tab, the editor, a deploy): an undo
  // would step over it, so the history goes. Our own write, still on its
  // way back through the refresh, is not a change.
  useEffect(() => {
    const h = historyRef.current;
    if (!raw || h.wrote === null || raw === h.wrote) return;
    if (raw === h.past[h.past.length - 1] || raw === h.future[h.future.length - 1]) return;
    setHistory(emptyHistory());
  }, [raw]);

  /** Undo or redo: the earlier text back through the flow route, refused
   *  there (409) when the file is no longer what we last wrote. */
  const travel = async (redo: boolean) => {
    const h = historyRef.current;
    if (!(redo ? h.future : h.past).length) return flash(redo ? "nothing to redo" : "nothing to undo");
    const current = h.wrote ?? raw;
    const plan = redo ? planRedo(h, current) : planUndo(h, current);
    if ("refused" in plan) {
      setHistory(plan.next);
      return setStatus(`not ${redo ? "redone" : "undone"} — ${plan.refused}`);
    }
    setStatus(redo ? "redoing…" : "undoing…");
    try {
      const res = await fetch(flowUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ restore: plan.write, expect: current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setHistory(emptyHistory());
        return setStatus(`not ${redo ? "redone" : "undone"} — the flow changed outside the canvas since your last edit; history cleared`);
      }
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      setHistory(plan.next);
      flash(redo ? "redone" : "undone");
      router.refresh();
    } catch (err) {
      setStatus(`not ${redo ? "redone" : "undone"} — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** An agent's file is the workspace's, not this flow's: say how far an
   *  edit reaches before it is written — the list view's warning. */
  const agentScope = async (agent: string, what: string) => {
    const others = (usedBy[agent] ?? []).filter((f) => f !== flow);
    if (!others.length) return true;
    return confirm({
      title: `Change agents/${agent}/agent.md?`,
      body: (
        <>
          {what} Also used by <span className="font-medium text-fg-secondary">{others.join(", ")}</span> — the change reaches{" "}
          {others.length === 1 ? "that flow" : `those ${others.length} flows`} too.
        </>
      ),
      confirmLabel: "Change the agent",
      destructive: false,
    });
  };

  const refuse = (why: string) => setStatus(`not saved — ${why}`);

  const pickAgent = (title: string, extra: Field[] = [], body?: ReactNode) =>
    prompt({
      title,
      body,
      submit: "Add",
      fields: [{ name: "agent", label: "Agent", type: "select", required: true, options: agentNames.map((a) => ({ value: a, label: a })) }, ...extra],
    });

  // --- step-level patterns ---
  const applyStepPattern = async (index: number, pattern: Pattern) => {
    const s = steps[index];
    const label = s.subflow ? `flow:${s.subflow}` : s.agent;
    switch (pattern) {
      case "fanout": {
        const v = await prompt({
          title: `Fan out ${label}`,
          body: "The step runs once per item of what the step before it returned.",
          submit: "Fan out",
          fields: [
            { name: "each", label: "Once per", type: "select", required: true, initial: s.each === "rows" ? "rows" : (s.each ?? "lines"), options: [
              { value: "lines", label: "line of the previous result" },
              { value: "items", label: "item of the previous step's JSON array" },
              { value: "rows", label: "row of a CSV file" },
            ] },
            { name: "path", label: "CSV path (rows only)", type: "text", placeholder: "workspace/storage/leads.csv", initial: s.eachPath ?? "" },
            { name: "max", label: "At most (1–20, optional)", type: "text", placeholder: "10", initial: s.max != null ? String(s.max) : "" },
          ],
        });
        if (!v) return;
        if (v.each === "rows" && !v.path.trim()) return refuse("rows needs the CSV's path");
        return flowEdit({ op: "options", step: index, set: { each: v.each === "rows" ? `rows of ${v.path.trim()}` : v.each, max: v.max || null } });
      }
      case "loop": {
        const v = await prompt({
          title: `Evaluator loop on ${label}`,
          body: "When this step's reply lacks the marker, the flow winds back to the step before and goes again.",
          submit: "Loop",
          fields: [
            { name: "loop", label: "Extra cycles, at most (1–5)", type: "text", required: true, initial: s.loop != null ? String(s.loop) : "3" },
            { name: "until", label: "Until the reply says", type: "text", required: true, initial: s.until ?? "APPROVED" },
            { name: "judge", label: "Also judge (optional) — a claim a model grades", type: "text", placeholder: "the draft cites every source", initial: s.verify?.startsWith("judge: ") ? s.verify.slice(7) : "" },
          ],
        });
        if (!v) return;
        const set: Record<string, string | null> = { loop: v.loop, until: v.until };
        if (v.judge.trim()) set.verify = `judge: ${v.judge.trim()}`;
        return flowEdit({ op: "options", step: index, set });
      }
      case "approve":
        return flowEdit({ op: "approve", step: index, on: !s.approve });
      case "ask": {
        const v = await prompt({
          title: `Ask a person before ${label}`,
          body: "The run stops at this step and asks; the answer reaches the step.",
          submit: s.ask ? "Save" : "Ask",
          fields: [{ name: "q", label: "Question (empty removes it)", type: "text", initial: s.ask ?? "" }],
        });
        if (!v) return;
        return flowEdit({ op: "options", step: index, set: { ask: v.q.trim() || null } });
      }
      case "wait": {
        const v = await prompt({
          title: `Wait before ${label}`,
          submit: "Save",
          fields: [{ name: "w", label: "90s, 30m, 4h, 3d — or event (empty removes it)", type: "text", placeholder: "30m", initial: s.waitFor === "event" ? "event" : s.waitSecs != null ? `${s.waitSecs}s` : "" }],
        });
        if (!v) return;
        return flowEdit({ op: "options", step: index, set: { wait: v.w.trim() || null } });
      }
      case "rescue": {
        const v = await prompt({
          title: `Rescue ${label}`,
          body: "When the step fails, this agent takes it over with the same instruction and the failure as context.",
          submit: "Save",
          fields: [{ name: "a", label: "Rescuer", type: "select", initial: s.onFail ?? "", options: agentNames.filter((a) => a !== s.agent).map((a) => ({ value: a, label: a })) }],
        });
        if (!v) return;
        return flowEdit({ op: "options", step: index, set: { "on-fail": v.a || null } });
      }
      case "parallel": {
        const v = await pickAgent(`Run beside ${label}`, [{ name: "instruction", label: "What it should do (optional)", type: "text" }]);
        if (!v) return;
        return flowEdit({ op: "insert", target: v.agent, instruction: v.instruction, at: { column: nodeColumn(index) } });
      }
    }
  };

  const nodeColumn = (index: number) => layout.columns.findIndex((c) => c.steps.includes(index));

  // --- docks: an agent's team ---
  const addToTeam = async (index: number, dock: "sub" | "consult", worker?: string) => {
    const owner = steps[index]?.agent;
    const team = teams[owner];
    if (!team) return refuse(`${owner} is not an agent in this workspace`);
    let name = worker;
    if (!name) {
      const v = await pickAgent(dock === "sub" ? `A sub-agent for ${owner}` : `A colleague ${owner} consults`);
      if (!v) return;
      name = v.agent;
    }
    if (name === owner) return refuse(dock === "sub" ? "an agent does not delegate to itself" : "an agent does not consult itself");
    const list = dock === "sub" ? team.subagents : team.consults;
    if (list.includes(name)) return refuse(`${name} is already ${dock === "sub" ? "a sub-agent" : "consulted"} here`);
    const w = teams[name];
    if (!w) return refuse(`${name} is not an agent in this workspace`);
    // The model picks a sub-agent by its description, and the runner skips
    // one without — so ask for it now rather than let check find it.
    if (dock === "sub" && !w.description.trim()) {
      const v = await prompt({
        title: `What is ${name} for?`,
        body: `${owner} picks a sub-agent by its description, and ${name} has none. It is written into agents/${name}/agent.md.`,
        submit: "Save description",
        fields: [{ name: "d", label: "Description", type: "textarea", required: true, placeholder: "Finds and summarises sources for a brief." }],
      });
      if (!v) return;
      if (!(await agentScope(name, `Sets ${name}'s description.`))) return;
      if (!(await agentEdit(name, { set: { key: "description", value: v.d } }))) return;
    }
    const key = dock === "sub" ? "subagents" : "agents";
    if (!(await agentScope(owner, `Adds ${name} to ${owner}'s ${key}:.`))) return;
    await agentEdit(owner, { list: { key, name, action: "add" } });
  };

  const removeChild = async (parent: number, kind: "sub" | "consult", name: string) => {
    const owner = steps[parent]?.agent;
    const key = kind === "sub" ? "subagents" : "agents";
    const others = (usedBy[owner] ?? []).filter((f) => f !== flow);
    const ok = await confirm({
      title: `Remove ${name} from ${owner}'s ${key}:?`,
      body: others.length
        ? `agents/${owner}/agent.md is also used by ${others.join(", ")} — the change reaches ${others.length === 1 ? "that flow" : "those flows"} too.`
        : `Edits agents/${owner}/agent.md.`,
      confirmLabel: "Remove",
    });
    if (ok) await agentEdit(owner, { list: { key, name, action: "remove" } });
  };

  /** Delete one step: confirm with what else changes (core's removalImpact,
   *  from the steps already here), then core's removeStep via PATCH { edit }. */
  const removeStepAt = async (index: number) => {
    const s = steps[index];
    if (!s) return;
    const impact = removalImpact(steps, index);
    const ok = await confirm({
      title: `Delete ${impact.label} from ${flow}?`,
      body: (
        <ul className="list-disc space-y-1 pl-4">
          {impact.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ),
      confirmLabel: "Delete step",
    });
    if (!ok) return;
    selectOnly([]);
    setPanel(null);
    await flowEdit({ op: "remove", step: index });
  };

  /** Delete several: one confirm, one write — removals highest index first,
   *  so each index still names the step it did when the list was made. */
  const removeSelection = async (indices: number[]) => {
    if (indices.length === 1) return removeStepAt(indices[0]);
    if (!indices.length) return;
    const names = indices.map((i) => `${nodeColumn(i) + 1} · ${steps[i].subflow ? `flow: ${steps[i].subflow}` : steps[i].agent}`);
    const ok = await confirm({
      title: `Delete ${indices.length} steps from ${flow}?`,
      body: (
        <>
          <ul className="list-disc space-y-0.5 pl-4">
            {names.map((n) => (
              <li key={n}>Step {n}</li>
            ))}
          </ul>
          <p className="mt-2">Their agents&apos; files stay. One edit — {MOD}Z undoes it.</p>
        </>
      ),
      confirmLabel: `Delete ${indices.length} steps`,
    });
    if (!ok) return;
    selectOnly([]);
    setPanel(null);
    await flowPatch({ edits: [...indices].sort((a, b) => b - a).map((step) => ({ op: "remove", step })) });
  };

  const toggleAsk = async (index: number) => {
    const owner = steps[index]?.agent;
    const team = teams[owner];
    if (!team) return;
    const on = team.tools.includes("ask");
    if (!(await agentScope(owner, on ? `Takes ask out of ${owner}'s tools:.` : `Adds ask to ${owner}'s tools: — it may then ask you mid-step.`))) return;
    await agentEdit(owner, { list: { key: "tools", name: "ask", action: on ? "remove" : "add" } });
  };

  // --- copy, paste, duplicate ---
  const copySteps = async (indices: number[]) => {
    const text = stepsMarkdown(raw, steps, indices);
    if (!text) return refuse("nothing to copy — select a step");
    keep(text);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // kept for Paste on this page; the system clipboard refused
    }
    flash(indices.length === 1 ? "step copied" : `${indices.length} steps copied`);
  };

  /** Pasted after the selection (its last column), else at the end. */
  const pasteSteps = async (text: string | null, after?: number) => {
    let t = text ?? shared.copied;
    if (!t) {
      try {
        t = await navigator.clipboard.readText();
      } catch {
        t = null;
      }
    }
    if (!t || !looksLikeSteps(t)) return refuse("nothing to paste — copy a step first (its markdown, e.g. 2. [[writer]] — draft)");
    const anchor = after ?? (selectedSteps.length ? Math.max(...selectedSteps.map(nodeColumn)) + 1 : layout.columns.length);
    await flowEdit({ op: "paste", text: t, at: { rail: anchor } });
  };

  const duplicate = (index: number) => flowEdit({ op: "duplicate", step: index });

  // --- runs ---
  const qs = tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : "";
  const post = async (url: string, body: unknown): Promise<{ runId?: string } | null> => {
    setStatus("starting…");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      flash("started");
      return data;
    } catch (err) {
      setStatus(`not started — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const startFlow = async (test: boolean) => {
    if (!test) {
      const ok = await confirm({
        title: `Run ${flow} now?`,
        body: "A live run: every step runs for real, and what it sends, sends. Choose Test run instead to keep it inside.",
        confirmLabel: "Run flow",
        destructive: false,
      });
      if (!ok) return;
    }
    const data = await post(`${flowUrl}/run`, test ? { test: true } : {});
    if (data?.runId) {
      setPicked(data.runId);
      router.refresh();
    }
  };

  /** Re-run the newest finished run from this step's record. */
  const runFromHere = async (index: number) => {
    const v = lastViews?.[index];
    if (!last || !v) return;
    if (!last.test) {
      const ok = await confirm({
        title: `Run ${flow} again from step ${nodeColumn(index) + 1}?`,
        body: `A new live run from ${last.id}: the steps before this one are carried with their results and not billed again; this step and every one after it run for real.`,
        confirmLabel: "Run from here",
        destructive: false,
      });
      if (!ok) return;
    }
    const data = await post(`/api/workspaces/${workspace}/runs/${last.id}/rerun`, { step: v.runStep });
    if (data?.runId) {
      setPicked(data.runId);
      router.refresh();
    }
  };

  /** One agent, alone, as a test run, with this step's instruction. */
  const testStep = async (index: number) => {
    const s = steps[index];
    if (!s || s.subflow || !teams[s.agent]) return;
    const data = await post(`/api/workspaces/${workspace}/agents/${s.agent}/run`, { task: s.instruction ?? "", test: true });
    if (data?.runId) router.push(`/dashboard/${workspace}/runs/${data.runId}${qs}`);
  };

  const runFromBlocked = (index: number): string | false =>
    !last
      ? "No finished run of this flow yet — run it once first"
      : !lastViews?.[index]
        ? `The last run (${last.id}) has no record for this step — the flow changed since`
        : false;
  const testBlocked = (index: number): string | false => {
    const s = steps[index];
    if (!s) return "no such step";
    if (s.subflow) return "A [[flow:x]] step is a whole flow — run that flow instead";
    if (!teams[s.agent]) return `${s.agent} is not an agent in this workspace`;
    return false;
  };

  // --- drops ---
  const insertAt = async (t: DropTarget, p: Payload) => {
    const at = t.kind === "column" ? { column: t.column } : { rail: t.rail };
    if (p.kind === "agent") {
      return flowEdit({ op: "insert", target: p.name, at });
    }
    switch (p.pattern) {
      case "chain":
      case "parallel": {
        if (p.pattern === "parallel" && t.kind !== "column") return refuse("Parallel joins a column — drop it onto one");
        const v = await pickAgent(p.pattern === "chain" ? "Chain a step" : "Run in parallel", [
          { name: "instruction", label: "What it should do (optional)", type: "text" },
        ], describeDrop(t, layout.columns.length));
        if (!v) return;
        // Chain always makes its own group: on a column, it takes that column's place.
        const where = p.pattern === "chain" && t.kind === "column" ? { rail: t.column } : at;
        return flowEdit({ op: "insert", target: v.agent, instruction: v.instruction, at: where });
      }
      case "subflow": {
        if (!otherFlows.length) return refuse("there is no other flow in this workspace to run");
        const v = await prompt({
          title: "Run another flow as a step",
          body: describeDrop(t, layout.columns.length),
          submit: "Add",
          fields: [{ name: "f", label: "Flow", type: "select", required: true, options: otherFlows.map((f) => ({ value: f, label: f })) }],
        });
        if (!v) return;
        return flowEdit({ op: "insert", target: v.f, subflow: true, at });
      }
      case "router": {
        const opts = agentNames.map((a) => ({ value: a, label: a }));
        const v = await prompt({
          title: "Router",
          body: "A triage step, then a column of branches: the first case: whose word leads a line of its reply runs; else: when none did.",
          submit: "Add router",
          fields: [
            { name: "router", label: "Triage agent", type: "select", required: true, options: opts },
            { name: "instruction", label: "Its instruction", type: "text", placeholder: "Reply BUG, DOCS or OTHER on the first line" },
            { name: "c1", label: "Case 1 — when the reply says", type: "text", required: true, placeholder: "BUG" },
            { name: "a1", label: "…run", type: "select", required: true, options: opts },
            { name: "c2", label: "Case 2 (optional)", type: "text", placeholder: "DOCS" },
            { name: "a2", label: "…run", type: "select", options: opts },
            { name: "c3", label: "Case 3 (optional)", type: "text" },
            { name: "a3", label: "…run", type: "select", options: opts },
            { name: "else", label: "Else (optional)", type: "select", options: opts },
          ],
        });
        if (!v) return;
        const cases = [1, 2, 3].map((k) => ({ value: v[`c${k}`].trim(), target: v[`a${k}`] })).filter((c) => c.value && c.target);
        const rail = t.kind === "column" ? t.column + 1 : t.rail;
        return flowEdit({ op: "router", router: v.router, instruction: v.instruction, rail, cases, else: v.else || undefined });
      }
      default:
        return refuse(`drop ${PATTERNS.find((x) => x.pattern === p.pattern)?.label ?? p.pattern} onto a step`);
    }
  };

  const dropOnStep = async (index: number, zone: "body" | "sub" | "consult") => {
    const p = payloadRef.current;
    payloadRef.current = null;
    setTarget(null);
    if (!p) return;
    if (zone !== "body") {
      if (p.kind === "agent") return addToTeam(index, zone, p.name);
      return addToTeam(index, zone);
    }
    if (p.kind === "agent") return flowEdit({ op: "insert", target: p.name, at: { column: nodeColumn(index) } });
    if (p.pattern === "workers" || p.pattern === "consult") return addToTeam(index, p.pattern === "workers" ? "sub" : "consult");
    if (p.pattern === "chain" || p.pattern === "router" || p.pattern === "subflow") {
      return insertAt({ kind: "gap", rail: nodeColumn(index) + 1 }, p);
    }
    return applyStepPattern(index, p.pattern);
  };

  const flowX = (e: { clientX: number; clientY: number }) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }).x;

  const onPaneDragOver = (e: DragEvent) => {
    if (!payloadRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const t = dropTarget(layout.columns, flowX(e));
    setTarget((old) => (JSON.stringify(old) === JSON.stringify(t) ? old : t));
  };
  const onPaneDrop = (e: DragEvent) => {
    e.preventDefault();
    const p = payloadRef.current;
    payloadRef.current = null;
    const t = dropTarget(layout.columns, flowX(e));
    setTarget(null);
    if (!p) return;
    if (!t) return refuse("drop between columns for a new step, or onto a column to run in parallel");
    void insertAt(t, p);
  };

  // --- selection and node drags: snap or refuse ---
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "select") {
        setSelection((prev) => (c.selected ? (prev.includes(c.id) ? prev : [...prev, c.id]) : prev.filter((x) => x !== c.id)));
      }
      if (c.type === "position" && c.position && c.dragging) {
        const pos = c.position;
        setDrag((d) => ({ ...d, [c.id]: pos }));
      }
    }
  }, []);

  const onNodeDrag = (_: unknown, node: Node) => {
    setTarget(dropTarget(layout.columns, node.position.x + NODE_W / 2));
  };
  const onNodeDragStop = (_: unknown, node: Node, dragged: Node[]) => {
    setDrag({});
    setTarget(null);
    const indices = (dragged.length ? dragged : [node]).filter((n) => n.id.startsWith("step-")).map((n) => Number(n.id.slice(5)));
    if (!indices.length) return;
    const t = dropTarget(layout.columns, node.position.x + NODE_W / 2);
    if (!t) return refuse("a step goes between columns or into one — not onto the trigger");
    const plan = indices.length > 1 ? planMoveMany(steps, indices, t) : planMove(steps, indices[0], t);
    if ("noop" in plan) return;
    if ("refused" in plan) return refuse(plan.refused);
    void flowPatch({ groups: plan.groups });
  };

  const fold = (group: number) => setCollapsed((c) => (c.includes(group) ? c : [...c, group]));
  const unfold = (group: number) => setCollapsed((c) => c.filter((g) => g !== group));

  const ctx: Ctx = {
    payload: () => payloadRef.current,
    dropOnStep: (i, z) => void dropOnStep(i, z),
    hover: setHovered,
    hovered,
    toggleAsk: (i) => void toggleAsk(i),
    addToDock: (i, d) => void addToTeam(i, d),
    removeChild: (p, k, n) => void removeChild(p, k, n),
    removeStep: (i) => void removeStepAt(i),
    openTrigger: () => {
      selectOnly(["trigger"]);
      setPanel("trigger");
    },
    openMenu: (index, at) => {
      touch(me);
      selectOnly([`step-${index}`]);
      setMenu({ index, ...at });
    },
    unfold,
  };

  const toggleMinimap = () =>
    setMinimap((m) => {
      writeMinimap(!m);
      return !m;
    });

  const goTo = (index: number) => {
    const n = layout.nodes.find((x) => x.id === `step-${index}`) ?? layout.nodes.find((x) => x.kind === "summary" && x.data.steps.includes(index));
    if (!n) return;
    selectOnly([n.id]);
    moved.current = true;
    void rf.setCenter(n.x + n.w / 2, n.y + n.h / 2, { zoom: Math.max(rf.getZoom(), 0.8), duration: 250 });
  };

  // --- the command palette: built when it opens, from that moment's state ---
  const buildCommands = (): Command[] => {
    const list: Command[] = [];
    const sel = selectedStep;
    const selName = sel != null ? `${nodeColumn(sel) + 1} · ${steps[sel].subflow ?? steps[sel].agent}` : null;
    const end: DropTarget = { kind: "gap", rail: layout.columns.length };
    const after: DropTarget = sel != null ? { kind: "gap", rail: nodeColumn(sel) + 1 } : end;
    list.push({ id: "add", label: sel != null ? `Add a step after step ${selName}` : "Add a step at the end", run: () => void insertAt(after, { kind: "pattern", pattern: "chain" }) });
    list.push({ id: "router", label: sel != null ? `Add a router after step ${selName}` : "Add a router at the end", run: () => void insertAt(after, { kind: "pattern", pattern: "router" }) });
    if (otherFlows.length) list.push({ id: "subflow", label: "Run another flow as a step", run: () => void insertAt(after, { kind: "pattern", pattern: "subflow" }) });
    for (const [p, l] of [
      ["fanout", "Fan-out"],
      ["loop", "Evaluator loop"],
      ["approve", "Approval gate (pause before)"],
      ["ask", "Ask a person before"],
      ["wait", "Wait before"],
      ["rescue", "Rescue on failure"],
      ["parallel", "Add a step beside"],
    ] as [Pattern, string][]) {
      list.push({
        id: `pattern-${p}`,
        label: sel != null ? `${l} — on step ${selName}` : `${l}…`,
        disabled: sel == null ? "select one step first" : false,
        run: () => sel != null && void applyStepPattern(sel, p),
      });
    }
    list.push({ id: "run", label: `Run ${flow}`, hint: "asks first — a live run", run: () => void startFlow(false) });
    list.push({ id: "test", label: `Test run ${flow}`, hint: "nothing outward happens", run: () => void startFlow(true) });
    if (sel != null) {
      list.push({ id: "run-from", label: `Run from step ${selName}`, disabled: runFromBlocked(sel), run: () => void runFromHere(sel) });
      list.push({ id: "test-step", label: `Test step ${selName} alone`, disabled: testBlocked(sel), run: () => void testStep(sel) });
    }
    list.push({ id: "undo", label: "Undo", keys: `${MOD}Z`, disabled: history.past.length ? false : "nothing to undo", run: () => void travel(false) });
    list.push({ id: "redo", label: "Redo", keys: `Shift+${MOD}Z`, disabled: history.future.length ? false : "nothing to redo", run: () => void travel(true) });
    const none = selectedSteps.length ? false : "select a step first";
    list.push({ id: "dup", label: "Duplicate step", keys: `${MOD}D`, disabled: selectedStep == null ? "select one step first" : false, run: () => selectedStep != null && void duplicate(selectedStep) });
    list.push({ id: "copy", label: selectedSteps.length > 1 ? `Copy ${selectedSteps.length} steps` : "Copy step", keys: `${MOD}C`, disabled: none, run: () => void copySteps(selectedSteps) });
    list.push({ id: "paste", label: "Paste steps", keys: `${MOD}V`, run: () => void pasteSteps(null) });
    list.push({ id: "delete", label: selectedSteps.length > 1 ? `Delete ${selectedSteps.length} steps` : "Delete step", keys: "Del", disabled: none, run: () => void removeSelection(selectedSteps) });
    list.push({ id: "minimap", label: minimap ? "Hide the minimap" : "Show the minimap", keys: "M", run: toggleMinimap });
    for (const c of layout.columns) {
      if (c.steps.length < 2) continue;
      const shut = collapsed.includes(c.group);
      list.push({ id: `fold-${c.group}`, label: `${shut ? "Unfold" : "Fold"} parallel step ${c.column + 1} (${c.steps.length} steps)`, run: () => (shut ? unfold(c.group) : fold(c.group)) });
    }
    layout.columns.forEach((c) =>
      c.steps.forEach((i) =>
        list.push({ id: `go-${i}`, label: `Go to step ${c.column + 1} · ${steps[i].subflow ? `flow: ${steps[i].subflow}` : steps[i].agent}`, run: () => goTo(i) }),
      ),
    );
    list.push({ id: "keys", label: "Keyboard shortcuts", keys: "?", run: () => setSheet(true) });
    list.push({ id: "find", label: "Find anywhere in the account…", hint: "the page's search", run: () => window.dispatchEvent(new Event(FIND_EVENT)) });
    return list;
  };
  const openPalette = () => {
    setMenu(null);
    setPalette(buildCommands());
  };

  // --- keyboard: only for the canvas last touched, never while typing ---
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (shared.active !== me) return;
      if (ask || palette || sheet || dialogOpen.current) return;
      if (typing(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") {
        // The page's Find owns ⌘K everywhere else; right after you touch a
        // canvas, it is this canvas's palette (which offers Find too).
        e.preventDefault();
        e.stopImmediatePropagation();
        openPalette();
      } else if (mod && k === "z") {
        e.preventDefault();
        void travel(e.shiftKey);
      } else if (mod && k === "y") {
        e.preventDefault();
        void travel(true);
      } else if (mod && k === "d") {
        if (selectedStep == null) return;
        e.preventDefault();
        void duplicate(selectedStep);
      } else if (mod && k === "c") {
        // Text the person selected on the page copies as text.
        if (!selectedSteps.length || (window.getSelection()?.toString() ?? "")) return;
        e.preventDefault();
        void copySteps(selectedSteps);
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        if (!selectedSteps.length) return;
        e.preventDefault();
        void removeSelection(selectedSteps);
      } else if (e.key === "Escape") {
        setMenu(null);
        selectOnly([]);
      } else if (e.key === "?" && !mod) {
        e.preventDefault();
        setSheet(true);
      } else if (k === "m" && !mod && !e.altKey) {
        toggleMinimap();
      }
    };
    pasteRef.current = (e: ClipboardEvent) => {
      if (shared.active !== me || ask || palette || dialogOpen.current || typing(e.target)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeSteps(text)) return;
      e.preventDefault();
      void pasteSteps(text);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onPaste = (e: ClipboardEvent) => pasteRef.current(e);
    // Touching anything that is not a canvas hands the keys back.
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-canvas-root="${CSS.escape(me)}"], [role="menu"], [role="dialog"]`)) release(me);
    };
    // Capture, so ⌘K reaches this canvas before the page's Find hears it.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("pointerdown", away, true);
      release(me);
    };
  }, [me]);

  const band = target
    ? target.kind === "column"
      ? { x: layout.columns[target.column].x - 10, w: NODE_W + 20 }
      : {
          x:
            target.rail === 0
              ? (layout.columns[0]?.x ?? 0) - COL_GAP + 24
              : layout.columns[target.rail - 1].x + NODE_W + 24,
          w: COL_GAP - 48,
        }
    : null;

  const beginDrag = (e: DragEvent, p: Payload) => {
    payloadRef.current = p;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", p.kind === "agent" ? p.name : p.pattern);
  };
  const endDrag = () => {
    payloadRef.current = null;
    setTarget(null);
    setHovered(null);
  };
  const paletteItem = "cursor-grab select-none rounded-md border bg-surface px-2 py-1 text-left text-xs active:cursor-grabbing";

  const sel = selectedStep != null ? steps[selectedStep] : null;
  const tool = buttonClass("minimal", "border-line px-2 py-0.5 text-xs disabled:opacity-40");
  const recent = runs.slice(0, 14).reverse();

  return (
    <CanvasCtx.Provider value={ctx}>
      {confirmDialog}
      {ask && <FormDialog key={ask.title} ask={ask} />}
      {palette && <CommandPalette commands={palette} onClose={() => setPalette(null)} />}
      {sheet && <ShortcutSheet onClose={() => setSheet(false)} />}
      {menu && steps[menu.index] && (
        <NodeMenu
          at={menu}
          step={steps[menu.index]}
          column={nodeColumn(menu.index)}
          folded={layout.columns[nodeColumn(menu.index)]?.steps.length > 1 ? layout.columns[nodeColumn(menu.index)].group : null}
          runFrom={runFromBlocked(menu.index)}
          testAlone={testBlocked(menu.index)}
          lastRun={last}
          onClose={() => setMenu(null)}
          act={(what) => {
            const i = menu.index;
            setMenu(null);
            if (what === "run-from") void runFromHere(i);
            else if (what === "test") void testStep(i);
            else if (what === "pause") void flowEdit({ op: "approve", step: i, on: !steps[i].approve });
            else if (what === "duplicate") void duplicate(i);
            else if (what === "copy") void copySteps([i]);
            else if (what === "paste") void pasteSteps(null, nodeColumn(i) + 1);
            else if (what === "fold") fold(layout.columns[nodeColumn(i)].group);
            else if (what === "delete") void removeStepAt(i);
          }}
        />
      )}
      <div
        className="mt-3 flex min-h-5 flex-wrap items-center gap-3 text-xs"
        onPointerDown={() => touch(me)}
      >
        <ExpandableTitle open={editing} onToggle={() => setEditing((e) => !e)} name={flow} meta={`flows/${file}`} />
        {status && (
          <Badge variant={status.startsWith("not ") ? "error" : status === "saved" || status === "undone" || status === "redone" ? "success" : "default"}>{status}</Badge>
        )}
      </div>
      {editing && <InlineEditor workspace={workspace} tenant={tenant} path={`flows/${file}`} />}
      <div className="mt-3 flex flex-col gap-3 md:flex-row" data-canvas-root={me} onPointerDown={() => touch(me)} onFocus={() => touch(me)}>
        <aside className="w-full shrink-0 space-y-3 md:w-52" aria-label="Palette — drag onto the canvas">
          <div>
            <p className={FIELD_LABEL_CLASS}>Agents</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {agents.map((a) => (
                <div
                  key={a.name}
                  draggable
                  onDragStart={(e) => beginDrag(e, { kind: "agent", name: a.name })}
                  onDragEnd={endDrag}
                  title={`${a.model} · ${a.description || "no description"}`}
                  className={`${paletteItem} border-line-strong font-medium text-fg`}
                >
                  {a.name}
                </div>
              ))}
              <button
                type="button"
                className="rounded-md border border-dashed border-line-strong px-2 py-1 text-left text-xs text-fg-muted hover:border-gray-500 hover:text-fg"
                title="Create agents/<name>/agent.md"
                onClick={async () => {
                  const v = await prompt({
                    title: "New agent",
                    body: "Creates agents/<name>/agent.md in this workspace, from the template.",
                    submit: "Create",
                    fields: [
                      { name: "name", label: "Name — lower case, digits, dashes", type: "text", required: true, placeholder: "researcher" },
                      { name: "description", label: "What it is for (other agents pick it by this)", type: "text", required: true },
                      { name: "model", label: "Model", type: "select", required: true, initial: "default", options: [
                        { value: "fast", label: "fast" }, { value: "default", label: "default" }, { value: "max", label: "max" },
                      ] },
                    ],
                  });
                  if (!v) return;
                  if (!/^[a-z0-9][a-z0-9-]*$/.test(v.name.trim())) return refuse("a name is lower case letters, digits and dashes");
                  await send(`/api/workspaces/${workspace}/agents`, "POST", { name: v.name.trim(), description: v.description, model: v.model });
                }}
              >
                + New agent
              </button>
            </div>
          </div>
          <div>
            <p className={FIELD_LABEL_CLASS}>Flows</p>
            <div
              draggable
              onDragStart={(e) => beginDrag(e, { kind: "pattern", pattern: "subflow" })}
              onDragEnd={endDrag}
              className={`${paletteItem} mt-1 border-dashed border-emerald-500 text-emerald-800`}
              title="[[flow:x]] — another flow of this workspace, as one step"
            >
              Run another flow
            </div>
          </div>
          <div>
            <p className={FIELD_LABEL_CLASS}>Patterns</p>
            <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-2">
              {PATTERNS.map((p) => (
                <div
                  key={p.pattern}
                  draggable
                  onDragStart={(e) => beginDrag(e, { kind: "pattern", pattern: p.pattern })}
                  onDragEnd={endDrag}
                  className={`${paletteItem} border-line`}
                  title={p.hint}
                >
                  <span className="block font-medium leading-tight text-fg">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* The toolbar: what the run overlay shows, and the controls. */}
          <div className="mb-1 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted" role="toolbar" aria-label={`Canvas controls for ${flow}`}>
            <RunPicker
              recent={recent}
              shown={shown}
              mode={runMode}
              link={link}
              followingLive={!picked && !!live}
              onPick={(id) => setPicked(id)}
              onClear={() => setPicked("none")}
            />
            <span className="ml-auto flex items-center gap-1">
              <button type="button" className={tool} onClick={() => void travel(false)} disabled={!history.past.length} title={`Undo the last edit made here (${MOD}Z)`} aria-label="Undo">
                Undo
              </button>
              <button type="button" className={tool} onClick={() => void travel(true)} disabled={!history.future.length} title={`Redo (Shift+${MOD}Z)`} aria-label="Redo">
                Redo
              </button>
              <button type="button" className={tool} onClick={toggleMinimap} aria-pressed={minimap} title="Show or hide the minimap (M)">
                Minimap
              </button>
              <button type="button" className={tool} onClick={openPalette} title={`Commands: add, run, go to a step (${MOD}K)`}>
                {MOD}K
              </button>
              <button type="button" className={tool} onClick={() => setSheet(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
                ?
              </button>
            </span>
          </div>
          <div className="mb-1 flex min-h-5 items-center gap-2 text-xs text-fg-muted">
            {target ? (
              <span className="font-medium text-sky-800">release — {describeDrop(target, layout.columns.length)}</span>
            ) : selectedSteps.length > 1 ? (
              <span className="font-medium text-fg-secondary">
                {selectedSteps.length} steps selected — drag them together, {MOD}C copies, Delete removes
              </span>
            ) : (
              <span>Drag a node between columns to make it its own step, or into a column to run in parallel. Shift-click or Shift-drag selects several. Right-click a step for its menu.</span>
            )}
          </div>
          <div
            ref={paneRef}
            style={{ height: full ? "100vh" : fit.height }}
            className="rounded-lg border border-line bg-paper"
            data-canvas={flow}
            onDragOver={onPaneDragOver}
            onDrop={onPaneDrop}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setTarget(null);
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={() => {
                selectOnly([]);
                setPanel(null);
                setMenu(null);
              }}
              onNodeContextMenu={(e, n) => {
                if (!n.id.startsWith("step-")) return;
                e.preventDefault();
                touch(me);
                const index = Number(n.id.slice(5));
                if (!selection.includes(n.id)) selectOnly([n.id]);
                setMenu({ index, x: e.clientX, y: e.clientY });
              }}
              onMoveStart={(e) => {
                // Only a person's pan or zoom — not our own setViewport.
                if (e) moved.current = true;
              }}
              nodesConnectable={false}
              // Our own Delete handler confirms first; React Flow's would
              // drop the node from view without writing anything.
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              nodesFocusable
              edgesFocusable={false}
              zoomOnScroll={false}
              preventScrolling={false}
              zoomOnDoubleClick={false}
              minZoom={0.1}
              maxZoom={1.5}
              // MIT-licensed; the authors ask commercial users to consider
              // React Flow Pro, which we may do — hiding the badge is allowed.
              proOptions={{ hideAttribution: true }}
              aria-label={`Canvas for flow ${flow}`}
            >
              {band && (
                <ViewportPortal>
                  <div
                    style={{ position: "absolute", transform: `translate(${band.x}px, 8px)`, width: band.w, height: layout.height }}
                    className={`pointer-events-none rounded-lg ${target?.kind === "column" ? "bg-sky-500/10 ring-1 ring-sky-400" : "border-2 border-dashed border-sky-400 bg-sky-500/5"}`}
                  />
                </ViewportPortal>
              )}
              <Controls showInteractive={false} showFitView={false} position="bottom-right">
                <ControlButton onClick={fitAll} title="Fit the whole flow" aria-label="Fit the whole flow">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
                  </svg>
                </ControlButton>
                <ControlButton onClick={toggleFull} title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    {full ? <path d="M2 7h5V2M14 9H9v5M7 7L2 2M9 9l5 5" /> : <path d="M9 2h5v5M14 2L9 7M7 14H2V9M2 14l5-5" />}
                  </svg>
                </ControlButton>
              </Controls>
              {minimap && (
                <MiniMap
                  position="bottom-left"
                  pannable
                  zoomable
                  ariaLabel={`Minimap of ${flow}`}
                  className="!h-[90px] !w-[150px] rounded border border-line"
                  nodeColor={(n) => {
                    if (n.type === "step") {
                      const r = (n.data as RunData).run;
                      return r && (n.data as RunData).runMode === "watch" ? STATUS_HEX[r.status] : "var(--color-gray-400)";
                    }
                    if (n.type === "summary") return "var(--color-gray-500)";
                    if (n.type === "trigger") return "var(--color-gray-300)";
                    return "var(--color-gray-200)";
                  }}
                  maskColor="color-mix(in oklab, var(--color-gray-900) 6%, transparent)"
                />
              )}
            </ReactFlow>
          </div>

          {panel === "trigger" && (
            <div className="mt-2">
              <TriggerEditor
                workspace={workspace}
                flow={flow}
                trigger={trigger}
                schedule={schedule}
                timezone={timezone}
                startOpen
                onClose={() => setPanel(null)}
              />
            </div>
          )}

          {sel && selectedStep != null && (
            <div className="mt-2 rounded-lg border border-line bg-surface p-3" aria-label="Selected step">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-fg">
                  Step {nodeColumn(selectedStep) + 1} · {sel.subflow ? `flow: ${sel.subflow}` : sel.agent}
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  <button type="button" className={buttonClass("secondary", "px-2 py-0.5 text-xs")} onClick={() => setPanel(panel === "options" ? null : "options")}>⚙ Options</button>
                  <button type="button" className={buttonClass("secondary", "px-2 py-0.5 text-xs")} onClick={() => setPanel(panel === "instruction" ? null : "instruction")}>Instruction</button>
                  {!sel.subflow && (
                    <button type="button" className={buttonClass("secondary", "px-2 py-0.5 text-xs")} onClick={() => setPanel(panel === "agent" ? null : "agent")}>Agent file</button>
                  )}
                  <button
                    type="button"
                    className={buttonClass("destructive", "px-2 py-0.5 text-xs")}
                    onClick={() => void removeStepAt(selectedStep)}
                  >
                    Delete step
                  </button>
                </span>
              </div>
              {/* Every palette block, reachable without a mouse. */}
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Add a pattern to this step">
                {([
                  ["fanout", "Fan-out…"],
                  ["loop", "Evaluator loop…"],
                  ["approve", sel.approve ? "Remove approval" : "Approval gate"],
                  ["ask", "Ask a person…"],
                  ["wait", "Wait…"],
                  ["rescue", "Rescue…"],
                  ["parallel", "Add beside…"],
                ] as [Pattern, string][]).map(([p, l]) => (
                  <button key={p} type="button" className={buttonClass("minimal", "border-line px-2 py-0.5 text-xs")} onClick={() => void applyStepPattern(selectedStep, p)}>
                    {l}
                  </button>
                ))}
                <button type="button" className={buttonClass("minimal", "border-line px-2 py-0.5 text-xs")} onClick={() => void insertAt({ kind: "gap", rail: nodeColumn(selectedStep) + 1 }, { kind: "pattern", pattern: "chain" })}>
                  Add after…
                </button>
                <button type="button" className={buttonClass("minimal", "border-line px-2 py-0.5 text-xs")} onClick={() => void insertAt({ kind: "gap", rail: nodeColumn(selectedStep) + 1 }, { kind: "pattern", pattern: "router" })}>
                  Router after…
                </button>
                {!sel.subflow && (
                  <>
                    <button type="button" className={buttonClass("minimal", "border-line px-2 py-0.5 text-xs")} onClick={() => void addToTeam(selectedStep, "sub")}>Sub-agent…</button>
                    <button type="button" className={buttonClass("minimal", "border-line px-2 py-0.5 text-xs")} onClick={() => void addToTeam(selectedStep, "consult")}>Consult…</button>
                  </>
                )}
              </div>
              {panel === "options" && (
                <StepOptionsEditor
                  key={selectedStep}
                  workspace={workspace}
                  flow={flow}
                  index={selectedStep}
                  step={sel}
                  tenant={tenant}
                  expect={raw || undefined}
                  onClose={() => setPanel(null)}
                  onSaved={(w) => setHistory((h) => recordEdit(h, w.before, w.text))}
                  agentTools={sel.subflow ? [] : (teams[sel.agent]?.tools ?? undefined)}
                />
              )}
              {panel === "instruction" && (
                <InstructionEditor
                  key={selectedStep}
                  workspace={workspace}
                  tenant={tenant}
                  file={file}
                  value={sel.instruction ?? ""}
                  onCancel={() => setPanel(null)}
                  onSave={async (text) => {
                    if (await flowPatch({ step: selectedStep, instruction: text })) setPanel(null);
                  }}
                />
              )}
              {panel === "agent" && !sel.subflow && (
                <div className="mt-2 rounded-lg border border-line bg-sunken/60 px-3 pb-3">
                  <p className="pt-2 text-[11px] text-fg-muted">
                    <span className="font-mono text-fg-subtle">agents/{sel.agent}/agent.md</span>
                    {(() => {
                      const others = (usedBy[sel.agent] ?? []).filter((f) => f !== flow);
                      return others.length ? (
                        <>
                          {" — also used by "}
                          <span className="font-medium text-fg-tertiary">{others.join(", ")}</span>. Changes here reach{" "}
                          {others.length === 1 ? "that flow" : "those flows"} too.
                        </>
                      ) : (
                        <> — this workspace{"'"}s agent; it can also be run on its own.</>
                      );
                    })()}
                  </p>
                  <InlineEditor key={sel.agent} workspace={workspace} tenant={tenant} path={`agents/${sel.agent}/agent.md`} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </CanvasCtx.Provider>
  );
}

// ---------- the run picker ----------

const RUN_DOT: Record<string, string> = {
  completed: "bg-emerald-400",
  failed: "bg-red-400",
  stopped: "bg-gray-300",
  "awaiting-approval": "bg-amber-400",
  running: "bg-sky-400",
  queued: "bg-sky-300",
};

function RunPicker({
  recent,
  shown,
  mode,
  link,
  followingLive,
  onPick,
  onClear,
}: {
  recent: RunLite[];
  shown: RunLite | null;
  mode: RunMode | null;
  link: string;
  followingLive: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
}) {
  if (!recent.length && !shown) return <span className="text-fg-subtle">No runs yet — run the flow to see each step light up here.</span>;
  const word = (r: RunLite) => (r.status === "failed" && r.stopRequested ? "stopped" : r.status);
  const cost = shown ? shown.steps.reduce((n, s) => n + (s.costUsd ?? 0), 0) : 0;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-fg-subtle">{mode === "watch" ? (followingLive ? "Live run" : "Showing run") : "Last run"}</span>
      <span className="flex items-center gap-0.5" role="group" aria-label="Pick a run to show on the canvas">
        {recent.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            title={`${r.id} · ${word(r)}${r.test ? " · test" : ""} — show it on the canvas`}
            aria-label={`Show run ${r.id} (${word(r)}) on the canvas`}
            aria-pressed={shown?.id === r.id}
            className={`h-2.5 w-2.5 rounded-sm ${RUN_DOT[word(r)] ?? "bg-gray-300"} ${shown?.id === r.id ? "ring-2 ring-gray-900 ring-offset-1" : "opacity-70 hover:opacity-100"}`}
          />
        ))}
      </span>
      {shown && (
        <span className="truncate font-mono text-[11px] text-fg-muted" title={shown.id}>
          {shown.id}
          {shown.test ? " · test" : ""} · {word(shown)}
          {cost > 0 ? ` · ${money(cost)}` : ""}
          {mode === "watch" && link === "reconnecting" ? " · reconnecting…" : ""}
        </span>
      )}
      {mode === "watch" && (
        <button type="button" onClick={onClear} className="rounded px-1 text-fg-subtle hover:bg-muted hover:text-fg" title="Stop showing this run; idle steps show the last finished run" aria-label="Stop showing this run">
          ×
        </button>
      )}
    </span>
  );
}

// ---------- the node menu ----------

type MenuAction = "run-from" | "test" | "pause" | "duplicate" | "copy" | "paste" | "fold" | "delete";

function NodeMenu({
  at,
  step,
  column,
  folded,
  runFrom,
  testAlone,
  lastRun,
  onClose,
  act,
}: {
  at: { x: number; y: number };
  step: FlowStep;
  column: number;
  folded: number | null;
  runFrom: string | false;
  testAlone: string | false;
  lastRun: RunLite | null;
  onClose: () => void;
  act: (a: MenuAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // The page scrolling moves the step from under a fixed menu: close it.
    // A scroll still settling from the click that opened it does not count.
    const opened = Date.now();
    const scrolled = () => Date.now() - opened > 400 && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", scrolled);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", scrolled);
    };
  }, [onClose]);
  const left = typeof window !== "undefined" ? Math.min(at.x, window.innerWidth - 236) : at.x;
  const top = typeof window !== "undefined" ? Math.min(at.y, window.innerHeight - 320) : at.y;
  const item = (a: MenuAction, label: ReactNode, o: { disabled?: string | false; hint?: string; danger?: boolean } = {}) => (
    <button
      type="button"
      role="menuitem"
      disabled={!!o.disabled}
      title={o.disabled || o.hint}
      onClick={() => act(a)}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-45 ${
        o.danger ? "text-red-700 hover:bg-red-50" : "text-gray-800 hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Step ${column + 1} · ${step.subflow ?? step.agent}`}
      style={{ position: "fixed", left: Math.max(8, left - 220), top: Math.max(8, top) }}
      className="z-50 w-56 rounded-lg border border-line bg-surface p-1 shadow-xl"
    >
      <p className="truncate px-2 pb-1 pt-0.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-subtle">
        Step {column + 1} · {step.subflow ? `flow: ${step.subflow}` : step.agent}
      </p>
      {item("run-from", "Run from here", { disabled: runFrom, hint: lastRun ? `A new run from ${lastRun.id}: earlier steps carried, this one and after run again — asks first` : undefined })}
      {item("test", "Test this step alone", { disabled: testAlone, hint: "Runs this agent once with this step's instruction, as a test run — nothing outward happens" })}
      {item("pause", <>{step.approve ? "✓ " : ""}Pause before</>, { hint: step.approve ? "Remove the approval gate (the ! / approve: true)" : "A person approves before this step runs — writes the ! marker" })}
      <div className="my-1 border-t border-line-faint" />
      {item("duplicate", <>Duplicate<span className="ml-auto text-fg-subtle">{MOD}D</span></>, { hint: "A copy beside it, in the same group" })}
      {item("copy", <>Copy<span className="ml-auto text-fg-subtle">{MOD}C</span></>, { hint: "The step's markdown, options and all — paste into any flow" })}
      {item("paste", <>Paste after<span className="ml-auto text-fg-subtle">{MOD}V</span></>, { hint: "Copied steps, as the next step" })}
      {folded != null && item("fold", "Fold this parallel group", { hint: "Draw the group as one node — a view choice, nothing is written" })}
      <div className="my-1 border-t border-line-faint" />
      {item("delete", <>Delete<span className="ml-auto text-red-400">Del</span></>, { danger: true, hint: "Asks first; the agent file stays" })}
    </div>
  );
}

// ---------- the command palette and the shortcut sheet ----------

/** Every word of the query, in order, somewhere in the label. */
function matches(label: string, q: string): boolean {
  const l = label.toLowerCase();
  let at = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = l.indexOf(w, at);
    if (i < 0) return false;
    at = i + w.length;
  }
  return true;
}

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = commands.filter((c) => matches(c.label, q));
  const pick = Math.min(at, Math.max(0, list.length - 1));
  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    c.run();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Commands" className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((pick + 1) % Math.max(1, list.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((pick - 1 + list.length) % Math.max(1, list.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(list[pick]);
            } else if (e.key === "Escape") onClose();
          }}
          placeholder="Add a step, run, go to step 3…"
          aria-label="Search commands"
          className="w-full border-b border-line px-4 py-3 text-sm outline-none"
        />
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
          {list.length === 0 && <li className="px-3 py-2 text-xs text-fg-subtle">No command matches.</li>}
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === pick} aria-disabled={!!c.disabled}>
              <button
                type="button"
                onMouseEnter={() => setAt(i)}
                onClick={() => run(c)}
                disabled={!!c.disabled}
                title={c.disabled || c.hint}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${i === pick ? "bg-muted text-fg" : "text-fg-secondary"}`}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.disabled ? <span className="shrink-0 text-[11px] text-fg-subtle">{c.disabled}</span> : c.hint && <span className="shrink-0 text-[11px] text-fg-subtle">{c.hint}</span>}
                {c.keys && <kbd className="shrink-0 rounded border border-line bg-sunken px-1 font-sans text-[10.5px] text-fg-muted">{c.keys}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-keys-title"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2 id="canvas-keys-title" className="text-sm font-semibold text-fg">Canvas shortcuts</h2>
        <p className="mt-1 text-xs text-fg-muted">For the canvas you last clicked; never while you type in a field or editor.</p>
        <dl className="mt-3 space-y-1.5 text-xs">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-36 shrink-0">
                <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-sans text-[11px] text-fg-secondary">{k}</kbd>
              </dt>
              <dd className="text-fg-tertiary">{what}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <button type="button" autoFocus onClick={onClose} className={buttonClass("secondary")}>Close</button>
        </div>
      </div>
    </div>
  );
}
