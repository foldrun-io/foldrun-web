"use client";

// One step's options, editable — the last reason to open the file editor
// for orchestration. Everything here writes through updateFlowStep, which
// touches only this step's option lines, so the file diff is exactly what
// was changed.

import { $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FlowStep } from "@/lib/store";

import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, labelClass } from "@foldrun/ui/react/input";
import { limitRows, limitProblems, limitKeyProblem, limitCountProblem, limitsText, type LimitRow } from "@/components/step-limits-model";
import { WEB_ACTIONS } from "@/lib/providers.ts";
import { flowWrite } from "@/components/flow-write";
import { Checkbox } from "@foldrun/ui/react/choice";
import { Combobox } from "@foldrun/ui/react/combobox";

const LABEL = labelClass;

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
  const [maxOut, setMaxOut] = useState(step.maxOutputTokens != null ? String(step.maxOutputTokens) : "");
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
      url: `/v1/workspaces/${workspace}/flows/${flow}`,
      method: "PATCH",
      tenant,
      expect: typeof expect === "function" ? expect() : expect,
      body: {
        step: index,
        options: {
          model: opt(model),
          effort: opt(effort),
          max_output_tokens: opt(maxOut),
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
      setError(res.error || $t("workspace.flows-step-options.couldNotSave"));
      setBusy(false);
    }
  }

  const limitKeys = ["calls", "web", ...WEB_ACTIONS.map((a) => `web.${a}`), ...(agentTools ?? []).filter((t) => t !== "web")];
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-line bg-sunken p-3 sm:grid-cols-4">
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.model")}</span>
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={$t("workspace.flows-step-options.fastDefaultMax")} />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.effort")}</span>
        <Input
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          placeholder={$t("workspace.flows-step-options.lowMediumHighXhighMax")}
        />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.longestReplyTokens")}</span>
        <Input value={maxOut} onChange={(e) => setMaxOut(e.target.value)} inputMode="numeric" placeholder={$t("workspace.flows-step-options.theAgentS")} />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.retriesOnFailure")}</span>
        <Input value={retry} onChange={(e) => setRetry(e.target.value)} placeholder="0–5" />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.timeoutS")}</span>
        <Input value={timeout_} onChange={(e) => setTimeout_(e.target.value)} placeholder="none" />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.runOnlyWhenALineOf")}</span>
        <Input value={when} onChange={(e) => setWhen(e.target.value)} placeholder={$t("workspace.flows-step-options.eGUrgentOrRowsOf")} />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.routeRunWhenResultsSayFirst")}</span>
        <Input value={case_} onChange={(e) => setCase(e.target.value)} placeholder="e.g. BUG" />
      </label>
      <label className="flex items-end gap-2 pb-1">
        <Checkbox checked={else_} onCheckedChange={(checked: boolean) => setElse(checked)} />
        <span className="text-xs text-fg-secondary">{$t("workspace.flows-step-options.elseRunWhenNoRouteMatched")}</span>
      </label>
      <label className="col-span-2">
        <span className={LABEL}>{$t("workspace.flows-step-options.verifyShellCommandThatMustExit")}</span>
        <Input value={verify} onChange={(e) => setVerify(e.target.value)} placeholder="test -s outputs/report.md" className="font-mono" />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.loopBackCycles15")}</span>
        <Input value={loop} onChange={(e) => setLoop(e.target.value)} placeholder="off" />
      </label>
      <label>
        <span className={LABEL}>{$t("workspace.flows-step-options.untilResultSays")}</span>
        <Input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="APPROVED" />
      </label>
      <label className="flex items-end gap-2 pb-1">
        <Checkbox checked={each} onCheckedChange={(checked: boolean) => setEach(checked)} />
        <span className="text-xs text-fg-secondary">{$t("workspace.flows-step-options.fanOutPerLineOfPrevious")}</span>
      </label>
      {each && (
        <label>
          <span className={LABEL}>{$t("workspace.flows-step-options.maxItems120")}</span>
          <Input value={max} onChange={(e) => setMax(e.target.value)} placeholder="10" />
        </label>
      )}
      <fieldset className="col-span-2 sm:col-span-4">
        <legend className={LABEL}>{$t("workspace.flows-step-options.callLimitsHowManyCallsThis")}</legend>
        <div className="mt-1 space-y-1">
          {limits.map((r, i) => {
            const keyIssue = r.key.trim() || r.count.trim() ? limitKeyProblem(r.key, granted) : null;
            const countIssue = r.key.trim() || r.count.trim() ? limitCountProblem(r.count) : null;
            const set = (patch: Partial<LimitRow>) => setLimits((rows) => rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5" data-limit-row={i}>
                <span className="w-48 shrink-0">
                <Combobox
                  options={limitKeys}
                  value={r.key}
                  onChange={(e) => set({ key: e.target.value })}
                  placeholder="web.search"
                  aria-label={`Limit ${i + 1}: tool`}
                  aria-invalid={!!keyIssue}
                  className={`font-mono ${keyIssue ? "border-danger" : ""}`}
                />
                </span>
                <span className="w-24 shrink-0">
                <Input
                  value={r.count}
                  onChange={(e) => set({ count: e.target.value })}
                  inputMode="numeric"
                  placeholder="10"
                  aria-label={`Limit ${i + 1}: calls`}
                  aria-invalid={!!countIssue}
                  className={countIssue ? "border-danger" : ""}
                />
                </span>
                <button
                  type="button"
                  onClick={() => setLimits((rows) => rows.filter((_, j) => j !== i))}
                  aria-label={$t("workspace.flows-step-options.removeLimit", { v0: String(r.key || i + 1) })}
                  className="rounded px-1.5 text-sm text-fg-subtle hover:bg-danger-soft hover:text-danger"
                >
                  ×
                </button>
                {(keyIssue || countIssue) && <span className="text-xs text-danger">{keyIssue ?? countIssue}</span>}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLimits((rows) => [...rows, { key: "", count: "" }])}
            className="rounded border border-dashed border-line-strong px-2 py-0.5 text-xs text-fg-muted hover:border-fg-subtle hover:text-fg"
          >
            {$t("workspace.flows-step-options.addALimit")}
          </button>
        </div>
      </fieldset>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
        <button onClick={save} disabled={busy || limitIssues.length > 0} className={buttonVariants({ variant: "primary", size: "md" })}>
          {$t("workspace.flows-step-options.saveOptions")}
        </button>
        <button onClick={onClose} className={buttonVariants({ variant: "ghost", size: "md" })}>
          {$t("workspace.flows-step-options.cancel")}
        </button>
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
