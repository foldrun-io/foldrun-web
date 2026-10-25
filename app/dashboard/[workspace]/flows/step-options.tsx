"use client";

// One step's options, editable — the last reason to open the file editor
// for orchestration. Everything here writes through updateFlowStep, which
// touches only this step's option lines, so the file diff is exactly what
// was changed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FlowStep } from "@/lib/store";

import { inputClass, buttonClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { limitRows, limitProblems, limitKeyProblem, limitCountProblem, limitsText, type LimitRow } from "@/components/step-limits-model";
import { WEB_ACTIONS } from "@/lib/providers.ts";
import { flowWrite } from "@/components/flow-write";

const FIELD = inputClass();
const LABEL = FIELD_LABEL_CLASS;

export function StepOptionsEditor({
  workspace,
  flow,
  index,
  step,
  tenant,
  expect,
  onClose,
  onSaved,
  agentTools,
}: {
  workspace: string;
  flow: string;
  index: number;
  step: FlowStep;
  tenant?: string;
  /** The flow text `index` was read from, sent as `expect`: a stale editor
   *  is refused (409) instead of rewriting whichever step has that index now.
   *  A function is read at save time — the list board's text moves with its
   *  own optimistic writes before the page's refresh catches up. */
  expect?: string | (() => string | undefined);
  onClose: () => void;
  /** The file either side of the write — the canvas keeps it for undo. */
  onSaved?: (w: { before: string; text: string }) => void;
  /** The step's agent's tools: — what a `limits:` key may name besides
   *  web.<action>, web and calls. Left out, tool names are not checked here. */
  agentTools?: string[];
}) {
  const router = useRouter();
  const [model, setModel] = useState(step.model ?? "");
  const [effort, setEffort] = useState(step.effort ?? "");
  const [retry, setRetry] = useState(step.retry != null ? String(step.retry) : "");
  const [timeout_, setTimeout_] = useState(step.timeout != null ? String(step.timeout) : "");
  const [verify, setVerify] = useState(step.verify ?? "");
  const [when, setWhen] = useState(step.when ?? "");
  const [case_, setCase] = useState(step.case ?? "");
  const [else_, setElse] = useState(Boolean(step.else));
  const [loop, setLoop] = useState(step.loop != null ? String(step.loop) : "");
  const [until, setUntil] = useState(step.until ?? "");
  const [each, setEach] = useState(Boolean(step.each));
  const [max, setMax] = useState(step.max != null ? String(step.max) : "");
  const [limits, setLimits] = useState<LimitRow[]>(() => limitRows(step.limits));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const granted = agentTools ?? null;
  const limitIssues = limitProblems(limits, granted);

  async function save() {
    if (limitIssues.length) {
      setError(`limits: ${limitIssues[0]}`);
      return;
    }
    setBusy(true);
    setError(null);
    const opt = (v: string) => (v.trim() ? v.trim() : null);
    const res = await flowWrite({
      url: `/api/workspaces/${workspace}/flows/${flow}`,
      method: "PATCH",
      tenant,
      expect: typeof expect === "function" ? expect() : expect,
      body: {
        step: index,
        options: {
          model: opt(model),
          effort: opt(effort),
          retry: opt(retry),
          timeout: opt(timeout_),
          verify: opt(verify),
          when: opt(when),
          case: opt(case_),
          else: else_ ? "true" : null,
          loop: opt(loop),
          until: opt(until),
          each: each ? "lines" : null,
          max: each ? opt(max) : null,
          limits: limitsText(limits),
        },
      },
    });
    if (res.ok) {
      if (res.before !== undefined && res.text !== undefined) onSaved?.({ before: res.before, text: res.text });
      onClose();
      router.refresh();
    } else {
      setError(res.error || "could not save");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-line bg-sunken p-3 sm:grid-cols-4">
      <label>
        <span className={LABEL}>Model</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="fast · default · max" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Effort</span>
        <input
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          placeholder="low · medium · high · xhigh · max"
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>Retries on failure</span>
        <input value={retry} onChange={(e) => setRetry(e.target.value)} placeholder="0–5" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Timeout (s)</span>
        <input value={timeout_} onChange={(e) => setTimeout_(e.target.value)} placeholder="none" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Run only when a line of the previous result begins with — or a CSV has rows</span>
        <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="e.g. URGENT, or rows of workspace/storage/queue.csv" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Route: run when results say (first match wins)</span>
        <input value={case_} onChange={(e) => setCase(e.target.value)} placeholder="e.g. BUG" className={FIELD} />
      </label>
      <label className="flex items-end gap-2 pb-1">
        <input type="checkbox" checked={else_} onChange={(e) => setElse(e.target.checked)} />
        <span className="text-xs text-fg-secondary">Else — run when no route matched</span>
      </label>
      <label className="col-span-2">
        <span className={LABEL}>Verify — shell command that must exit 0 (the reply is in $FOLDRUN_REPLY_FILE)</span>
        <input value={verify} onChange={(e) => setVerify(e.target.value)} placeholder="test -s outputs/report.md" className={`${FIELD} font-mono`} />
      </label>
      <label>
        <span className={LABEL}>Loop back (cycles, 1–5)</span>
        <input value={loop} onChange={(e) => setLoop(e.target.value)} placeholder="off" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>…until result says</span>
        <input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="APPROVED" className={FIELD} />
      </label>
      <label className="flex items-end gap-2 pb-1">
        <input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} />
        <span className="text-xs text-fg-secondary">Fan out per line of previous result</span>
      </label>
      {each && (
        <label>
          <span className={LABEL}>Max items (1–20)</span>
          <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="10" className={FIELD} />
        </label>
      )}
      <fieldset className="col-span-2 sm:col-span-4">
        <legend className={LABEL}>Call limits — how many calls this step may make before the next is refused (over the agent&apos;s own limits:)</legend>
        <datalist id={`limit-keys-${index}`}>
          {["calls", "web", ...WEB_ACTIONS.map((a) => `web.${a}`), ...(agentTools ?? []).filter((t) => t !== "web")].map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <div className="mt-1 space-y-1">
          {limits.map((r, i) => {
            const keyIssue = r.key.trim() || r.count.trim() ? limitKeyProblem(r.key, granted) : null;
            const countIssue = r.key.trim() || r.count.trim() ? limitCountProblem(r.count) : null;
            const set = (patch: Partial<LimitRow>) => setLimits((rows) => rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5" data-limit-row={i}>
                <span className="w-48 shrink-0">
                <input
                  value={r.key}
                  onChange={(e) => set({ key: e.target.value })}
                  list={`limit-keys-${index}`}
                  placeholder="web.search"
                  aria-label={`Limit ${i + 1}: tool`}
                  aria-invalid={!!keyIssue}
                  className={inputClass(`font-mono ${keyIssue ? "border-red-400" : ""}`)}
                />
                </span>
                <span className="w-24 shrink-0">
                <input
                  value={r.count}
                  onChange={(e) => set({ count: e.target.value })}
                  inputMode="numeric"
                  placeholder="10"
                  aria-label={`Limit ${i + 1}: calls`}
                  aria-invalid={!!countIssue}
                  className={inputClass(countIssue ? "border-red-400" : "")}
                />
                </span>
                <button
                  type="button"
                  onClick={() => setLimits((rows) => rows.filter((_, j) => j !== i))}
                  aria-label={`Remove limit ${r.key || i + 1}`}
                  className="rounded px-1.5 text-sm text-fg-subtle hover:bg-red-50 hover:text-red-700"
                >
                  ×
                </button>
                {(keyIssue || countIssue) && <span className="text-[11px] text-red-600">{keyIssue ?? countIssue}</span>}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLimits((rows) => [...rows, { key: "", count: "" }])}
            className="rounded border border-dashed border-line-strong px-2 py-0.5 text-xs text-fg-muted hover:border-gray-500 hover:text-fg"
          >
            + Add a limit
          </button>
        </div>
      </fieldset>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
        <button onClick={save} disabled={busy || limitIssues.length > 0} className={buttonClass("primary")}>
          Save options
        </button>
        <button onClick={onClose} className={buttonClass("minimal")}>
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
