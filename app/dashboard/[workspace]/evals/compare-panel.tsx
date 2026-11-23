"use client";

// Compare models on one eval: its cases under two to four settings, side by
// side (POST …/evals/<e>/compare, then polled by its id). Every run is a test
// run, the judge stays the eval's own, and it stops at the spend limit. The
// answer is a table — passing, cost and time per setting, and per case where
// the settings differ — plus the comparisons kept before.

import { $t } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@foldrun/ui/react/link";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Input, labelClass } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Chip } from "@foldrun/ui/react/page";
import { runHref } from "@/components/run-href";
import type { EvalComparison } from "@/lib/eval-compare";
import { Combobox } from "@foldrun/ui/react/combobox";

const TIERS = ["fast", "default", "max"];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
/** Mirrors core eval-compare.ts — the route refuses past them anyway. */
const MAX_CONFIGS = 4;
const MAX_TRIALS = 60;

interface Row {
  model: string;
  effort: string;
  agent: string;
}

interface Past {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "done" | "failed";
  result?: EvalComparison;
  error?: string;
}

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`);

export function ComparePanel({
  workspace,
  tenant,
  evalName,
  cases,
  flowAgents,
  canStart = true,
}: {
  /** May this person start one (run:start)? Without it the panel shows the
   *  comparisons kept and follows a running one, and starts nothing. */
  canStart?: boolean;
  workspace: string;
  tenant: string;
  evalName: string;
  cases: number;
  /** A flow eval's agents, so one agent's steps can be compared alone; null for an agent eval. */
  flowAgents: string[] | null;
}) {
  const [rows, setRows] = useState<Row[]>([
    { model: "fast", effort: "", agent: "" },
    { model: "default", effort: "", agent: "" },
  ]);
  const [repeat, setRepeat] = useState(1);
  const [maxUsd, setMaxUsd] = useState(5);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<EvalComparison | null>(null);
  const [past, setPast] = useState<Past[]>([]);
  // False once the panel is gone: the poll stops with it rather than running
  // on (and doubling up when it is opened again) for a long comparison.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const base = `/v1/workspaces/${encodeURIComponent(workspace)}/evals/${encodeURIComponent(evalName)}/compare`;
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };
  const trials = cases * rows.length * repeat;

  const loadPast = useCallback(async () => {
    const res = await fetch(base, { headers: { "x-foldrun-tenant": tenant } });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPast((data.comparisons ?? []) as Past[]);
  }, [base, tenant]);

  // On open: the kept comparisons, and one still running is followed. The
  // state is set in the request's callbacks, never in the effect's body.
  useEffect(() => {
    let alive = true;
    fetch(base, { headers: { "x-foldrun-tenant": tenant } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { comparisons?: Past[]; running?: boolean; runId?: string; progress?: { done: number; total: number } } | null) => {
        if (!alive || !data) return;
        setPast(data.comparisons ?? []);
        if (data.running && data.runId) {
          setBusy(true);
          setProgress(data.progress ?? null);
          void follow(String(data.runId));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, tenant]);

  async function follow(runId: string) {
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        if (!mounted.current) return;
        const res = await fetch(`${base}?run=${encodeURIComponent(runId)}`, { headers: { "x-foldrun-tenant": tenant } });
        if (!mounted.current) return;
        const view = (await res.json().catch(() => ({}))) as { state?: string; error?: string; result?: EvalComparison; progress?: { done: number; total: number } };
        if (!res.ok) throw new Error(view.error ?? `HTTP ${res.status}`);
        if (view.state === "running") {
          setProgress(view.progress ?? null);
          continue;
        }
        if (view.state === "done" && view.result) setShown(view.result);
        else throw new Error(view.error ?? $t("workspace.evals-compare-panel.theComparisonEndedAs", { v0: String(view.state ?? $t("workspace.evals-compare-panel.unknown")) }));
        break;
      }
      await loadPast();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  const start = async () => {
    setError(null);
    setShown(null);
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({
          configs: rows.map((r) => ({ model: r.model.trim(), ...(r.effort ? { effort: r.effort } : {}), ...(r.agent ? { agent: r.agent } : {}) })),
          repeat,
          maxUsd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProgress({ done: 0, total: data.trials ?? trials });
      await follow(String(data.runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <p className="mb-4 text-sm text-fg-muted">
        {$t("workspace.evals-compare-panel.eachSettingRunsEveryCaseAs", { part: repeat > 1 ? $t("workspace.evals-compare-panel.times", { repeat: String(repeat) }) : "" })}
      </p>
      {canStart && (<>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label>
              <span className={labelClass}>{$t("workspace.evals-compare-panel.model")}</span>
              <Combobox options={TIERS} value={r.model} onChange={(e) => set(i, { model: e.target.value })} className="w-44 font-mono text-xs" />
            </label>
            <label>
              <span className={labelClass}>{$t("workspace.evals-compare-panel.effort")}</span>
              <Select value={r.effort} onChange={(e) => set(i, { effort: e.target.value })} >
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>{e || $t("workspace.evals-compare-panel.asWritten")}</option>
                ))}
              </Select>
            </label>
            {flowAgents && (
              <label>
                <span className={labelClass}>{$t("workspace.evals-compare-panel.steps")}</span>
                <Select value={r.agent} onChange={(e) => set(i, { agent: e.target.value })} >
                  <option value="">{$t("workspace.evals-compare-panel.everyStep")}</option>
                  {flowAgents.map((a) => (
                    <option key={a} value={a}>{$t("workspace.evals-compare-panel.only", { a: a })}</option>
                  ))}
                </Select>
              </label>
            )}
            {rows.length > 2 && (
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className={buttonVariants({ variant: "ghost", size: "md" })} aria-label={$t("workspace.evals-compare-panel.removeThisSetting")}>
                {$t("workspace.evals-compare-panel.remove")}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {rows.length < MAX_CONFIGS && (
          <button onClick={() => setRows((rs) => [...rs, { model: "max", effort: "", agent: "" }])} className={buttonVariants({ variant: "ghost", size: "md" })}>
            {$t("workspace.evals-compare-panel.setting")}
          </button>
        )}
        <label>
          <span className={labelClass}>{$t("workspace.evals-compare-panel.repeat")}</span>
          <Input type="number" min={1} max={5} value={repeat} onChange={(e) => setRepeat(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} className="w-16" />
        </label>
        <label>
          <span className={labelClass}>{$t("workspace.evals-compare-panel.spendLimitUsd")}</span>
          <Input type="number" min={0.5} max={100} step={0.5} value={maxUsd} onChange={(e) => setMaxUsd(Math.min(100, Math.max(0.5, Number(e.target.value) || 5)))} className="w-20" />
        </label>
        <span className={`pb-2 text-xs ${trials > MAX_TRIALS ? "text-danger" : "text-fg-muted"}`}>
          {$t("workspace.evals-compare-panel.runs", { trials: String(trials) })}{trials > MAX_TRIALS ? $t("workspace.evals-compare-panel.atMost", { MAX_TRIALS: String(MAX_TRIALS) }) : ""}
        </span>
        <button onClick={start} disabled={busy || trials > MAX_TRIALS || rows.some((r) => !r.model.trim())} className={buttonVariants({ variant: "primary", size: "md" })}>
          {busy ? $t("workspace.evals-compare-panel.comparing") : $t("workspace.evals-compare-panel.compare")}
        </button>
      </div>
      </>)}
      {busy && progress && (
        <p className="mt-2 text-xs text-fg-muted">
          {$t("workspace.evals-compare-panel.ofRunsDoneThisTakesAs", { done: String(progress.done), total: String(progress.total) })}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {shown && <ComparisonTable workspace={workspace} tenant={tenant} result={shown} />}

      {past.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-1.5 text-[13px] font-medium text-fg-muted">{$t("workspace.evals-compare-panel.earlierComparisons")}</p>
          <ul className="space-y-1">
            {past.slice(0, 8).map((p) => (
              <li key={p.runId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-fg-muted">{$t("workspace.evals-compare-panel.utc", { replace: p.startedAt.slice(0, 16).replace("T", " ") })}</span>
                {p.status === "done" && p.result ? (
                  <>
                    <span className="text-fg-secondary">{p.result.configs.map((c) => `${c.label}: ${pct(c.rate)}`).join(" · ")}</span>
                    <button onClick={() => setShown(p.result!)} className="text-link hover:underline">{$t("workspace.evals-compare-panel.show")}</button>
                  </>
                ) : (
                  <span className="text-danger">{p.error ?? $t("workspace.evals-compare-panel.failed")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ComparisonTable({ workspace, tenant, result }: { workspace: string; tenant: string; result: EvalComparison }) {
  const best = Math.max(...result.configs.map((c) => c.rate ?? -1));
  return (
    <div className="mt-3 overflow-x-auto">
      {result.stopped && <p className="mb-2 text-xs text-warning">{$t("workspace.evals-compare-panel.stoppedEarlyTheSettingsThatRan", { stopped: result.stopped })}</p>}
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[13px] text-fg-muted">
          <tr>
            <th className="py-1 pr-3 font-medium">{$t("workspace.evals-compare-panel.setting2")}</th>
            <th className="py-1 pr-3 font-medium">{$t("workspace.evals-compare-panel.passing")}</th>
            <th className="py-1 pr-3 font-medium">{$t("workspace.evals-compare-panel.cost")}</th>
            <th className="py-1 pr-3 font-medium">{$t("workspace.evals-compare-panel.perRun")}</th>
            <th className="py-1 pr-3 font-medium">{$t("workspace.evals-compare-panel.timePerRun")}</th>
            {result.cases.map((c) => (
              <Tooltip key={c.case} label={c.case.length > 18 ? c.case : undefined}>
                <th className="py-1 pr-3 font-medium normal-case">{c.case.length > 18 ? `${c.case.slice(0, 17)}…` : c.case}</th>
              </Tooltip>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.configs.map((c, i) => (
            <tr key={c.label} className="border-t border-line-faint">
              <td className="py-1.5 pr-3 font-mono text-fg">{c.label}</td>
              <td className="py-1.5 pr-3">
                <Chip tone={c.rate !== null && c.rate === best ? "good" : "default"}>{pct(c.rate)}</Chip>{" "}
                <span className="text-fg-muted">{c.passed}/{c.trials - c.notRun}{c.notRun ? $t("workspace.evals-compare-panel.notRun", { notRun: String(c.notRun) }) : ""}</span>
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{usd(c.costUsd)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{usd(c.avgCostUsd)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{c.avgSecs === null ? "—" : `${c.avgSecs}s`}</td>
              {result.cases.map((row) => (
                <td key={row.case} className={`py-1.5 pr-3 tabular-nums ${row.passed[i] < row.trials[i] ? "text-danger" : "text-fg-secondary"}`}>
                  {row.passed[i]}/{row.trials[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-fg-muted">
        {$t("workspace.evals-compare-panel.judge", { model: result.judge.model })}{result.judge.effort ? ` · ${result.judge.effort}` : ""}{" "}{$t("workspace.evals-compare-panel.spentOfCostIncludesTheJudges", { toFixed: result.spentUsd.toFixed(2), toFixed2: result.maxUsd.toFixed(2) })}
        {result.configs[0]?.runIds[0] && (
          <> · e.g. <Link href={runHref(workspace, result.configs[0].runIds[0], tenant)} className="text-link hover:underline">{$t("workspace.evals-compare-panel.aRun")}</Link></>
        )}
      </p>
    </div>
  );
}
