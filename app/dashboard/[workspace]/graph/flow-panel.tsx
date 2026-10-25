"use client";

// Drag-and-drop flow editor, extracted from the graph so the canvas stays
// minimal. Reorder steps by dragging, toggle ∥ (parallel with the step
// above) and ? (optional), then save — the flow's markdown is regenerated.

import { useState } from "react";
import { Badge, buttonClass, inputClass, selectClass, dashedButtonClass } from "@/components/ui";
import type { FlowInfo, FlowStep } from "@/lib/store";

interface EditableStep {
  agent: string;
  instruction: string;
  parallelWithPrev: boolean;
  optional: boolean;
}

function toEditable(steps: FlowStep[]): EditableStep[] {
  return steps.map((s, i) => ({
    agent: s.agent,
    instruction: s.instruction,
    parallelWithPrev: i > 0 && s.group === steps[i - 1].group,
    optional: s.optional,
  }));
}

function toMarkdown(flow: FlowInfo, steps: EditableStep[]): string {
  let group = 0;
  const lines = steps.map((s) => {
    if (!s.parallelWithPrev) group += 1;
    return `${group}${s.optional ? "?" : ""}. [[${s.agent}]] — ${s.instruction || "describe this step"}`;
  });
  const front = [`name: ${flow.name}`, `trigger: ${flow.trigger}`];
  if (flow.schedule) front.push(`schedule: "${flow.schedule}"`);
  if (flow.timezone) front.push(`timezone: ${flow.timezone}`);
  return `---\n${front.join("\n")}\n---\n\n${lines.join("\n")}\n`;
}

export function FlowPanel({
  workspace,
  tenant,
  flows,
  agents,
  onSaved,
}: {
  workspace: string;
  tenant: string;
  flows: FlowInfo[];
  agents: string[];
  onSaved: () => void;
}) {
  const [flowName, setFlowName] = useState(flows[0]?.name ?? "");
  const flow = flows.find((f) => f.name === flowName) ?? flows[0];
  const [steps, setSteps] = useState<EditableStep[]>(() => toEditable(flow?.steps ?? []));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!flow) {
    return (
      <div className="rounded-xl border border-line bg-surface/95 p-4 text-sm text-fg-muted shadow-lg backdrop-blur">
        No flows in this workspace yet.
      </div>
    );
  }

  const switchFlow = (name: string) => {
    const next = flows.find((f) => f.name === name);
    setFlowName(name);
    setSteps(toEditable(next?.steps ?? []));
    setStatus(null);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    if (next.length > 0) next[0] = { ...next[0], parallelWithPrev: false };
    setSteps(next);
  };

  const update = (i: number, patch: Partial<EditableStep>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    setStatus("saving…");
    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: `flows/${flow.file}`, content: toMarkdown(flow, steps) }),
    });
    setStatus(res.ok ? "saved" : "save failed");
    if (res.ok) {
      onSaved();
      setTimeout(() => setStatus(null), 1500);
    }
  };

  // Group numbers as the file will have them — shown so the panel and the
  // markdown never disagree.
  let group = 0;
  const groupOf = steps.map((s) => {
    if (!s.parallelWithPrev) group += 1;
    return group;
  });

  return (
    <div className="rounded-xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        {flows.length > 1 ? (
          <select
            value={flowName}
            onChange={(e) => switchFlow(e.target.value)}
            className={selectClass("min-w-0 flex-1 truncate font-mono font-semibold")}
          >
            {flows.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate font-mono text-sm font-semibold text-fg">{flow.name}</span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {status && <Badge variant={status === "save failed" ? "error" : "success"}>{status}</Badge>}
          <button onClick={save} className={buttonClass("primary")}>
            Save
          </button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {steps.map((s, i) => (
          <li
            key={i}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
            }}
            className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-1.5"
          >
            <span className="cursor-grab select-none text-fg-subtle" title="drag to reorder">
              ⠿
            </span>
            <span className="w-4 shrink-0 text-center font-mono text-[10px] text-fg-subtle">
              {groupOf[i]}
            </span>
            <select
              value={s.agent}
              onChange={(e) => update(i, { agent: e.target.value })}
              className={selectClass("shrink-0 font-mono")}
            >
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              value={s.instruction}
              onChange={(e) => update(i, { instruction: e.target.value })}
              placeholder="instruction"
              className={inputClass("min-w-0")}
            />
            {i > 0 && (
              <button
                title="run in parallel with the step above"
                onClick={() => update(i, { parallelWithPrev: !s.parallelWithPrev })}
                className={`px-1 text-xs ${s.parallelWithPrev ? "font-bold text-emerald-600" : "text-gray-300 hover:text-fg-muted"}`}
              >
                ∥
              </button>
            )}
            <button
              title="optional — failure won't fail the flow"
              onClick={() => update(i, { optional: !s.optional })}
              className={`px-1 text-xs ${s.optional ? "font-bold text-amber-600" : "text-gray-300 hover:text-fg-muted"}`}
            >
              ?
            </button>
            <button
              title="remove step"
              onClick={() =>
                setSteps(
                  steps
                    .filter((_, j) => j !== i)
                    .map((x, j) => (j === 0 ? { ...x, parallelWithPrev: false } : x)),
                )
              }
              className="px-1 text-xs text-gray-300 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() =>
          setSteps([
            ...steps,
            { agent: agents[0] ?? "", instruction: "", parallelWithPrev: false, optional: false },
          ])
        }
        className={dashedButtonClass("mt-2")}
      >
        + Add step
      </button>
      <p className="mt-2 text-[10px] leading-relaxed text-fg-subtle">
        Steps sharing a number run in parallel · ∥ joins the step above · ? makes it optional
      </p>
    </div>
  );
}
