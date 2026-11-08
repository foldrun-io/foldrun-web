"use client";

// Drag-and-drop flow editor, extracted from the graph so the canvas stays
// minimal. Reorder steps by dragging, toggle ∥ (parallel with the step
// above) and ? (optional), then save — the flow's markdown is regenerated.

import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Chip } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
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
  initial,
}: {
  workspace: string;
  tenant: string;
  flows: FlowInfo[];
  agents: string[];
  onSaved: () => void;
  /** The flow to open on; the first one when absent. */
  initial?: string;
}) {
  const [flowName, setFlowName] = useState(() => (initial && flows.some((f) => f.name === initial) ? initial : flows[0]?.name ?? ""));
  const flow = flows.find((f) => f.name === flowName) ?? flows[0];
  const [steps, setSteps] = useState<EditableStep[]>(() => toEditable(flow?.steps ?? []));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!flow) {
    return <p className="text-sm text-fg-muted">No flows in this workspace yet.</p>;
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
  const groupOf = steps.reduce<number[]>((acc, s, i) => [...acc, (acc[i - 1] ?? 0) + (s.parallelWithPrev ? 0 : 1)], []);

  const toggle = (on: boolean, tone: "good" | "warn") =>
    cn(
      "flex size-7 shrink-0 items-center justify-center rounded-md text-[13px] transition-colors",
      on ? (tone === "good" ? "bg-success-soft font-semibold text-success" : "bg-warning-soft font-semibold text-warning") : "text-fg-subtle hover:bg-muted hover:text-fg",
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {flows.length > 1 ? (
          <Select value={flowName} onChange={(e) => switchFlow(e.target.value)} aria-label="Flow" className="min-w-0 flex-1 font-medium">
            {flows.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{flow.name}</span>
        )}
        {status && <Chip tone={status === "save failed" ? "bad" : status === "saved" ? "good" : "default"}>{status}</Chip>}
        <Button variant="primary" size="md" onClick={save}>
          Save
        </Button>
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
            className="space-y-1.5 rounded-md border border-line bg-sunken p-2"
          >
            <div className="flex items-center gap-1">
              <Tooltip label="drag to reorder">
                <span className="cursor-grab text-fg-subtle">
                  <GripVertical className="size-4" aria-hidden />
                </span>
              </Tooltip>
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-fg-muted">{groupOf[i]}</span>
              <Select size="sm" value={s.agent} onChange={(e) => update(i, { agent: e.target.value })} aria-label={`Agent for step ${i + 1}`} className="min-w-0 flex-1">
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
              {i > 0 && (
                <Tooltip label="run in parallel with the step above">
                  <button
                    type="button"
                    aria-label="Run in parallel with the step above"
                    aria-pressed={s.parallelWithPrev}
                    onClick={() => update(i, { parallelWithPrev: !s.parallelWithPrev })}
                    className={toggle(s.parallelWithPrev, "good")}
                  >
                    ∥
                  </button>
                </Tooltip>
              )}
              <Tooltip label="optional — failure won't fail the flow">
                <button
                  type="button"
                  aria-label="Optional — failure won't fail the flow"
                  aria-pressed={s.optional}
                  onClick={() => update(i, { optional: !s.optional })}
                  className={toggle(s.optional, "warn")}
                >
                  ?
                </button>
              </Tooltip>
              <Tooltip label="remove step">
              <button
                type="button"
                aria-label="Remove step"
                onClick={() =>
                  setSteps(
                    steps
                      .filter((_, j) => j !== i)
                      .map((x, j) => (j === 0 ? { ...x, parallelWithPrev: false } : x)),
                  )
                }
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <X className="size-4" aria-hidden />
              </button>
              </Tooltip>
            </div>
            <Input
              value={s.instruction}
              onChange={(e) => update(i, { instruction: e.target.value })}
              placeholder="instruction"
              aria-label={`Instruction for step ${i + 1}`}
              className="h-8 text-[13px]"
            />
          </li>
        ))}
      </ul>

      <Button
        variant="secondary"
        className="w-full border-dashed"
        onClick={() =>
          setSteps([
            ...steps,
            { agent: agents[0] ?? "", instruction: "", parallelWithPrev: false, optional: false },
          ])
        }
      >
        <Plus aria-hidden />
        Add step
      </Button>
      <p className="text-xs leading-relaxed text-fg-muted">
        Steps sharing a number run in parallel · ∥ joins the step above · ? makes it optional
      </p>
    </div>
  );
}
