"use client";

// Drag-and-drop arrangement for one flow.
//
// Two gestures, matching the two things a flow file can say:
//   · drop a step ONTO another step's group  → they run in parallel
//   · drop a step ON A RAIL between groups   → it becomes its own step there
//
// State is an array of groups holding indices into the flow's parsed steps,
// which is exactly what the PATCH endpoint takes. The server renumbers the
// markdown and touches nothing else, so a rearrangement is a small git diff.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, buttonClass, inputClass, selectClass, dashedButtonClass, IconButton, PlayIcon } from "@/components/ui";
import { StepOptionsEditor } from "./step-options";
import { InlineEditor } from "@/components/inline-editor";
import { SmartTextarea } from "@/components/smart-textarea";
import type { FlowStep } from "@/lib/store";

import { joinGroup, splitToRail, type Groups } from "@/lib/arrange.ts";
import { useConfirm } from "@/components/confirm";
import { flowWrite } from "@/components/flow-write";

function toGroups(steps: FlowStep[]): Groups {
  const map = new Map<number, number[]>();
  steps.forEach((s, i) => map.set(s.group, [...(map.get(s.group) ?? []), i]));
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Same arrangement? Used to skip no-op saves. */
function same(a: Groups, b: Groups) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FlowBoard({
  name,
  workspace,
  tenant,
  flow,
  file,
  steps,
  raw,
  knownAgents,
  knownFlows,
  usedBy = {},
}: {
  /** The flow's name — this is the control that opens its editor. */
  name: string;
  workspace: string;
  tenant: string;
  flow: string;
  /** Filename under flows/, for the inline editor. */
  file: string;
  steps: FlowStep[];
  /** The file the steps were parsed from: every index-based write sends it
   *  as `expect`, so a stale board is refused (409) instead of editing
   *  whichever step has that index now. */
  raw?: string;
  knownAgents: string[];
  knownFlows: string[];
  /** agent name → every flow that calls it, this one included. */
  usedBy?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [groups, setGroups] = useState<Groups>(() => toGroups(steps));
  // Two copies of the same fact, deliberately. `draggingRef` is authoritative
  // for the drag handlers, because React state set inside onDragStart hasn't
  // applied by the time the first dragover fires — and re-rendering the dragged
  // node synchronously cancels the drag outright in some browsers. The state
  // copy is only for what the user sees, and is set a tick later.
  const draggingRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overGroup, setOverGroup] = useState<number | null>(null);
  const [overRail, setOverRail] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<number | null>(null);
  // Two editors, two scopes, deliberately separate: the agent's own file is
  // shared by every flow that calls it, while a step's instruction belongs to
  // this flow alone.
  const [agentFor, setAgentFor] = useState<number | null>(null);
  const [instructionFor, setInstructionFor] = useState<number | null>(null);

  // What the file reads as far as this board knows: the page's text, then
  // each of our own writes until the refresh brings the page's text back.
  const seen = useRef(raw);
  useEffect(() => {
    seen.current = raw;
  }, [raw]);
  const write = async (method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
    const r = await flowWrite({ url: `/api/workspaces/${workspace}/flows/${flow}`, method, tenant, body, expect: seen.current });
    if (!r.ok) throw new Error(r.error);
    if (r.text !== undefined) seen.current = r.text;
  };

  const known = new Set(knownAgents);
  const flowSet = new Set(knownFlows);

  const apply = async (next: Groups) => {
    if (same(next, groups)) return;
    const previous = groups;
    setGroups(next); // optimistic — the gesture should feel instant
    setStatus("saving…");
    try {
      await write("PATCH", { groups: next });
      setStatus("saved");
      setTimeout(() => setStatus(null), 1500);
      router.refresh();
    } catch (err) {
      setGroups(previous); // the file is the truth; put the board back
      setStatus(err instanceof Error ? `not saved — ${err.message}` : "not saved");
    }
  };

  const clearDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setOverGroup(null);
    setOverRail(null);
  };

  // Start a run at this step: everything before it is recorded as skipped,
  // and the step reads its inputs from storage/ like it would mid-run. The
  // cheap way to iterate on a late step without paying for the early ones.
  const runFrom = async (stepNo: number) => {
    if (
      !(await confirm({
        title: `Run ${name} from step ${stepNo}?`,
        body: `Steps before ${stepNo} will be skipped — this run leans on whatever they last left in storage/.`,
        confirmLabel: "Run",
      }))
    )
      return;
    setStatus("starting…");
    try {
      const res = await fetch(`/api/workspaces/${workspace}/flows/${flow}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ from: stepNo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      router.push(
        `/dashboard/${workspace}/runs/${data.runId}${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? `not started — ${err.message}` : "not started");
    }
  };

  // Add and remove change the number of steps, so the board's indices are
  // stale afterwards — re-render from the server rather than patching state.
  // Add appends at the end and names no index, so it needs no `expect`.
  const mutate = async (method: "POST" | "DELETE", body: Record<string, unknown>) => {
    setStatus("saving…");
    try {
      if (method === "DELETE") await write("DELETE", body);
      else {
        const res = await fetch(`/api/workspaces/${workspace}/flows/${flow}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `${res.status}`);
        }
      }
      setStatus("saved");
      setTimeout(() => setStatus(null), 1500);
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? `not saved — ${err.message}` : "not saved");
    }
  };

  const saveInstruction = async (index: number, instruction: string) => {
    setStatus("saving…");
    try {
      await write("PATCH", { step: index, instruction });
      setStatus("saved");
      setInstructionFor(null);
      setTimeout(() => setStatus(null), 1500);
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? `not saved — ${err.message}` : "not saved");
    }
  };

  // A drop rail. It was 8px tall with negative margins pulling it under its
  // neighbours, so there was almost nothing to hit — the group underneath took
  // every pointer event. While a drag is active it becomes a real target and
  // says what dropping there will do.
  const Rail = ({ at }: { at: number }) => {
    const active = overRail === at;
    const armed = dragging !== null;
    // Every rail used to say the same thing, so with a group between them
    // there was no way to tell which order a drop would produce. Say the
    // outcome, not the mechanic.
    const label =
      at === 0
        ? "runs first, before everything else"
        : at >= groups.length
          ? "runs last, after everything else"
          : `runs between step ${at} and step ${at + 1}`;
    return (
      <div
        onDragOver={(e) => {
          if (draggingRef.current === null) return;
          e.preventDefault();
          e.stopPropagation();
          setOverRail(at);
          setOverGroup(null);
        }}
        onDragEnter={(e) => e.preventDefault()}
        onDragLeave={() => setOverRail((r) => (r === at ? null : r))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const step = draggingRef.current;
          if (step !== null) apply(splitToRail(groups, step, at));
          clearDrag();
        }}
        className={`flex items-center justify-center overflow-hidden rounded-md transition-all ${
          armed ? "my-1 h-9 border border-dashed" : "h-1"
        } ${
          active
            ? "border-gray-900 bg-ink/5 text-fg"
            : armed
              ? "border-line-strong text-fg-subtle"
              : "border-transparent"
        }`}
      >
        {armed && (
          <span className="text-[11px] font-medium">
            {active ? `release — ${label}` : label}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4">
      {confirmDialog}
      <div className="mb-2 flex min-h-5 items-center gap-3 text-xs">
        {/* The card's header already names the flow; this is the way into
            its file. It names the path so it reads as a file you can open,
            not a section to collapse (nobody found the editor when it named
            nothing). */}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
          className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-fg-tertiary hover:border-gray-400 hover:text-fg"
        >
          {editing ? "Close" : "Edit"} flows/{file}
        </button>
        {dragging !== null && (
          <span className="text-fg-muted">
            Drop on a step to run them in parallel, or on a line to make it its own step.
          </span>
        )}
        {status && (
          <Badge variant={status.startsWith("not saved") ? "error" : status === "saved" ? "success" : "default"}>
            {status}
          </Badge>
        )}
      </div>

      <ol className="space-y-1">
        <Rail at={0} />
        {groups.map((group, g) => (
          <li key={group.join("-")}>
            <div
              onDragOver={(e) => {
                if (draggingRef.current === null) return;
                e.preventDefault();
                setOverGroup(g);
                setOverRail(null);
              }}
              onDragEnter={(e) => e.preventDefault()}
              onDragLeave={() => setOverGroup((x) => (x === g ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                const step = draggingRef.current;
                if (step !== null) apply(joinGroup(groups, step, group[0]));
                clearDrag();
              }}
              className={`flex gap-3 rounded-lg p-1 transition-colors ${
                overGroup === g ? "bg-muted ring-1 ring-gray-900" : ""
              }`}
            >
              <span className="mt-1.5 flex w-5 shrink-0 flex-col items-center gap-0.5">
                <span className="font-mono text-xs leading-5 text-fg-subtle">{g + 1}</span>
                {/* From step 1 is just the Run button above; from anywhere
                    later, this is how. */}
                {g > 0 && (
                  <span className="opacity-0 transition-opacity group-hover:opacity-100">
                    <IconButton
                      label={`Run from step ${g + 1} — earlier steps are skipped`}
                      side="right"
                      onClick={() => void runFrom(steps[group[0]].group)}
                    >
                      <PlayIcon />
                    </IconButton>
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                {group.length > 1 && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-600">
                    {group.length} in parallel
                  </p>
                )}
                {group.map((index) => {
                  const s = steps[index];
                  const missing = s.subflow ? !flowSet.has(s.subflow) : !known.has(s.agent);
                  return (
                    <div
                      key={index}
                      draggable
                      onDragStart={(e) => {
                        draggingRef.current = index;
                        e.dataTransfer.effectAllowed = "move";
                        // Firefox needs data set for a drag to start at all.
                        e.dataTransfer.setData("text/plain", String(index));
                        // Next tick: repainting this node now would abort the drag.
                        setTimeout(() => setDragging(index), 0);
                      }}
                      onDragEnd={clearDrag}
                      className={`cursor-grab rounded-lg border bg-surface px-3 py-2 transition-opacity active:cursor-grabbing ${
                        dragging === index ? "border-gray-900 opacity-40" : "border-line"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <svg
                          width="10"
                          height="14"
                          viewBox="0 0 10 14"
                          className="shrink-0 text-gray-300"
                          fill="currentColor"
                          aria-hidden
                        >
                          <circle cx="2" cy="2" r="1.2" />
                          <circle cx="8" cy="2" r="1.2" />
                          <circle cx="2" cy="7" r="1.2" />
                          <circle cx="8" cy="7" r="1.2" />
                          <circle cx="2" cy="12" r="1.2" />
                          <circle cx="8" cy="12" r="1.2" />
                        </svg>
                        {s.subflow ? (
                          <span className="text-sm font-medium text-fg">flow: {s.subflow}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAgentFor(agentFor === index ? null : index)}
                            title={
                              agentFor === index
                                ? "Close this agent's file"
                                : `Edit agents/${s.agent}/agent.md`
                            }
                            className="text-sm font-medium text-fg underline decoration-gray-300 decoration-dashed underline-offset-4 hover:decoration-gray-900"
                          >
                            {s.agent}
                          </button>
                        )}
                        {missing && <Badge variant="error">not found</Badge>}
                        {s.optional && <Badge>optional</Badge>}
                        {s.approve && <Badge variant="warning">needs approval</Badge>}
                        {s.when && <Badge className="max-w-full" title={s.when}><span className="truncate">when: {s.when}</span></Badge>}
                        {s.case && <Badge variant="info">case: {s.case}</Badge>}
                        {s.else && <Badge variant="info">else</Badge>}
                        {s.retry != null && <Badge>retry ×{s.retry}</Badge>}
                        {s.timeout != null && <Badge>{s.timeout}s</Badge>}
                        {s.waitSecs != null && <Badge variant="info">wait {s.waitSecs >= 86400 ? `${Math.round(s.waitSecs / 86400)}d` : s.waitSecs >= 3600 ? `${Math.round(s.waitSecs / 3600)}h` : `${s.waitSecs}s`}</Badge>}
                        {s.onFail && <Badge variant="warning">on-fail → {s.onFail}</Badge>}
                        {s.ask && <Badge variant="warning" title={s.ask}>asks a human</Badge>}
                        {s.delegate && s.delegate.length > 0 && <Badge variant="info">delegates: {s.delegate.join(", ")}</Badge>}
                        {s.model && <Badge variant="info">{s.model}</Badge>}
                        {s.verify && <Badge variant="success" className="max-w-full" title={s.verify}><span className="truncate">verify: {s.verify}</span></Badge>}
                        {s.loop != null && s.until && <Badge variant="warning" className="max-w-full" title={s.until}><span className="truncate">loop ×{s.loop} until “{s.until}”</span></Badge>}
                        {s.each && <Badge variant="info">fan-out {s.each}{s.max != null ? ` ×${s.max}` : ""}</Badge>}

                        {/* Drag is not reachable by keyboard, so the same two
                            moves are available as buttons. */}
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <IconButton
                            label="Move up"
                            disabled={g === 0 && group.length === 1}
                            onClick={() => apply(splitToRail(groups, index, g))}
                          >
                            <span className="block text-xs leading-none">↑</span>
                          </IconButton>
                          <IconButton
                            label="Move down"
                            disabled={g === groups.length - 1 && group.length === 1}
                            onClick={() => apply(splitToRail(groups, index, g + 2))}
                          >
                            <span className="block text-xs leading-none">↓</span>
                          </IconButton>
                          {g > 0 && (
                            <IconButton
                              label="Run in parallel with the step above"
                              onClick={() => apply(joinGroup(groups, index, groups[g - 1][0]))}
                            >
                              <span className="block text-xs leading-none">⇈</span>
                            </IconButton>
                          )}
                          <IconButton
                            label="Step options — model, retries, loops, fan-out"
                            onClick={() => setOptionsFor(optionsFor === index ? null : index)}
                          >
                            <span className="block text-xs leading-none">⚙</span>
                          </IconButton>
                          <IconButton
                            label="Remove this step"
                            tone="destructive"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `Remove ${s.subflow ?? s.agent} from this flow?`,
                                  confirmLabel: "Remove",
                                })
                              ) {
                                void mutate("DELETE", { step: index });
                              }
                            }}
                          >
                            <span className="block text-xs leading-none">✕</span>
                          </IconButton>
                        </span>
                      </div>
                      {instructionFor === index ? (
                        <InstructionEditor
                          workspace={workspace}
                          tenant={tenant}
                          file={file}
                          value={s.instruction ?? ""}
                          onCancel={() => setInstructionFor(null)}
                          onSave={(text) => void saveInstruction(index, text)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setInstructionFor(index)}
                          title="Edit what this step tells the agent to do — this flow only"
                          className="mt-1 block w-full rounded px-4 py-0.5 text-left text-xs leading-relaxed text-fg-muted hover:bg-sunken hover:text-fg"
                        >
                          {s.instruction || (
                            <span className="text-gray-300">no instruction — click to write one</span>
                          )}
                        </button>
                      )}
                      {agentFor === index && !s.subflow && (
                        <div className="mt-2 rounded-lg border border-line bg-sunken/60 px-3 pb-3">
                          {/* The scope, before the typing. An agent is the
                              workspace's, not this flow's, and an editor that
                              opens inside a flow card implies otherwise unless
                              it says so. */}
                          <p className="pt-2 text-[11px] text-fg-muted">
                            <span className="font-mono text-fg-subtle">agents/{s.agent}/agent.md</span>
                            {(() => {
                              const others = (usedBy[s.agent] ?? []).filter((f) => f !== name);
                              return others.length ? (
                                <>
                                  {" — also used by "}
                                  <span className="font-medium text-fg-tertiary">{others.join(", ")}</span>
                                  . Changes here reach {others.length === 1 ? "that flow" : "those flows"} too.
                                </>
                              ) : (
                                <> — this workspace{"'"}s agent; it can also be run on its own.</>
                              );
                            })()}
                          </p>
                          <InlineEditor
                            workspace={workspace}
                            tenant={tenant}
                            path={`agents/${s.agent}/agent.md`}
                          />
                        </div>
                      )}
                      {optionsFor === index && (
                        <StepOptionsEditor
                          workspace={workspace}
                          flow={flow}
                          index={index}
                          step={s}
                          tenant={tenant}
                          expect={() => seen.current}
                          onClose={() => setOptionsFor(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <Rail at={g + 1} />
          </li>
        ))}
      </ol>

      <AddStep
        knownAgents={knownAgents}
        knownFlows={knownFlows.filter((f) => f !== flow)} // a flow can't call itself
        onAdd={(target, subflow, instruction) => mutate("POST", { target, subflow, instruction })}
      />

      {/* The board covers arrangement; the file covers everything else —
          frontmatter, per-step options, the prose above the list. */}
      {editing && (
        <InlineEditor workspace={workspace} tenant={tenant} path={`flows/${file}`} />
      )}
    </div>
  );
}

/**
 * One step's instruction, edited in place.
 *
 * A textarea rather than an input: these are sentences with paths in them,
 * and a single-line box that scrolls sideways hides the half you are not
 * looking at. Enter saves, Shift+Enter is a newline that the save flattens
 * back to one line — the flow file's grammar is one step per line.
 *
 * A SmartTextarea rather than a plain one, because a step instruction is one
 * of exactly TWO places the runner resolves [[ ]] (the other is an agent's
 * body). This was the one field entitled to the link completions and the one
 * field without them: the same sentence edited through the file editor
 * offered them, and edited here on the board did not. `path` is the flow file
 * so the vocabulary is a flow's.
 */
export function InstructionEditor({
  workspace,
  tenant,
  file,
  value,
  onSave,
  onCancel,
}: {
  workspace: string;
  tenant: string;
  file: string;
  value: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <div className="mt-1 pl-4">
      <SmartTextarea
        autoFocus
        workspace={workspace}
        tenant={tenant}
        path={`flows/${file}`}
        value={text}
        rows={2}
        onChange={setText}
        onSave={() => onSave(text)}
        onKeyDown={(e) => {
          // Only reached when no completion list is open — SmartTextarea
          // takes Enter and Escape for the list first, which is the whole
          // point: accepting [[knowledge-doc]] must not save the step.
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(text);
          }
        }}
        className={inputClass("text-xs leading-relaxed")}
      />
      <div className="mt-1 flex items-center gap-2">
        <button type="button" onClick={() => onSave(text)} className={buttonClass("primary", "px-2 py-0.5 text-xs")}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("minimal", "px-2 py-0.5 text-xs")}>
          Cancel
        </button>
        <span className="text-[11px] text-fg-subtle">this flow only — the agent{"'"}s own file is unchanged</span>
      </div>
    </div>
  );
}

// Appending a step is the missing half of editing a flow: without it a new
// flow is just a name and a template line you have to open the file to change.
function AddStep({
  knownAgents,
  knownFlows,
  onAdd,
}: {
  knownAgents: string[];
  knownFlows: string[];
  onAdd: (target: string, subflow: boolean, instruction: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={dashedButtonClass("mt-2")}
      >
        + Add step
      </button>
    );
  }

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken/60 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        const subflow = target.startsWith("flow:");
        onAdd(subflow ? target.slice(5) : target, subflow, instruction);
        setOpen(false);
        setTarget("");
        setInstruction("");
      }}
    >
      <select
        autoFocus
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className={selectClass()}
      >
        <option value="">Choose an agent…</option>
        {knownAgents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
        {knownFlows.length > 0 && (
          <optgroup label="Flows">
            {knownFlows.map((f) => (
              <option key={f} value={`flow:${f}`}>
                flow: {f}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="what this step should do (optional)"
        className={inputClass("min-w-0 flex-1")}
      />
      <button className={buttonClass("primary")} disabled={!target}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className={buttonClass("minimal")}>
        Cancel
      </button>
    </form>
  );
}
