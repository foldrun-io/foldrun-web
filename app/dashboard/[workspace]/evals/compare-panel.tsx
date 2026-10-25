"use client";

// Compare models on one eval: its cases under two to four settings, side by
// side (POST …/evals/<e>/compare, then polled by its id). Every run is a test
// run, the judge stays the eval's own, and it stops at the spend limit. The
// answer is a table — passing, cost and time per setting, and per case where
// the settings differ — plus the comparisons kept before.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, buttonClass, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { runHref } from "@/components/run-href";
import type { EvalComparison } from "@/lib/eval-compare";

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

  const base = `/api/workspaces/${encodeURIComponent(workspace)}/evals/${encodeURIComponent(evalName)}/compare`;
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
        else throw new Error(view.error ?? `the comparison ended as ${view.state ?? "unknown"}`);
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
    <div className="mt-3 rounded-lg border border-line bg-sunken/40 p-3">
      <p className="mb-2 text-sm font-medium text-fg">Compare models</p>
      <p className="mb-3 text-xs text-fg-muted">
        Each setting runs every case{repeat > 1 ? `, ${repeat} times` : ""}, as test runs — nothing is sent. The judge stays this eval&apos;s own. It stops at the spend limit.
      </p>
      {canStart && (<>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label>
              <span className={FIELD_LABEL_CLASS}>Model</span>
              <input list="foldrun-tiers" value={r.model} onChange={(e) => set(i, { model: e.target.value })} className={inputClass("w-44 font-mono text-xs")} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>Effort</span>
              <select value={r.effort} onChange={(e) => set(i, { effort: e.target.value })} className={selectClass()}>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>{e || "as written"}</option>
                ))}
              </select>
            </label>
            {flowAgents && (
              <label>
                <span className={FIELD_LABEL_CLASS}>Steps</span>
                <select value={r.agent} onChange={(e) => set(i, { agent: e.target.value })} className={selectClass()}>
                  <option value="">every step</option>
                  {flowAgents.map((a) => (
                    <option key={a} value={a}>{a} only</option>
                  ))}
                </select>
              </label>
            )}
            {rows.length > 2 && (
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className={buttonClass("minimal")} aria-label="remove this setting">
                Remove
              </button>
            )}
          </div>
        ))}
        <datalist id="foldrun-tiers">
          {TIERS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {rows.length < MAX_CONFIGS && (
          <button onClick={() => setRows((rs) => [...rs, { model: "max", effort: "", agent: "" }])} className={buttonClass("minimal")}>
            + setting
          </button>
        )}
        <label>
          <span className={FIELD_LABEL_CLASS}>Repeat</span>
          <input type="number" min={1} max={5} value={repeat} onChange={(e) => setRepeat(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} className={inputClass("w-16")} />
        </label>
        <label>
          <span className={FIELD_LABEL_CLASS}>Spend limit, USD</span>
          <input type="number" min={0.5} max={100} step={0.5} value={maxUsd} onChange={(e) => setMaxUsd(Math.min(100, Math.max(0.5, Number(e.target.value) || 5)))} className={inputClass("w-20")} />
        </label>
        <span className={`pb-2 text-xs ${trials > MAX_TRIALS ? "text-red-600" : "text-fg-muted"}`}>
          {trials} runs{trials > MAX_TRIALS ? ` — at most ${MAX_TRIALS}` : ""}
        </span>
        <button onClick={start} disabled={busy || trials > MAX_TRIALS || rows.some((r) => !r.model.trim())} className={buttonClass("primary")}>
          {busy ? "Comparing…" : "Compare"}
        </button>
      </div>
      </>)}
      {busy && progress && (
        <p className="mt-2 text-xs text-fg-muted">
          {progress.done} of {progress.total} runs done — this takes as long as the runs do; you can leave and come back.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {shown && <ComparisonTable workspace={workspace} tenant={tenant} result={shown} />}

      {past.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Earlier comparisons</p>
          <ul className="space-y-1">
            {past.slice(0, 8).map((p) => (
              <li key={p.runId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-fg-muted">{p.startedAt.slice(0, 16).replace("T", " ")} UTC</span>
                {p.status === "done" && p.result ? (
                  <>
                    <span className="text-fg-secondary">{p.result.configs.map((c) => `${c.label}: ${pct(c.rate)}`).join(" · ")}</span>
                    <button onClick={() => setShown(p.result!)} className="text-accent hover:underline">show</button>
                  </>
                ) : (
                  <span className="text-red-600">{p.error ?? "failed"}</span>
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
      {result.stopped && <p className="mb-2 text-xs text-amber-700">Stopped early: {result.stopped}. The settings that ran fewer trials are marked.</p>}
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="py-1 pr-3 font-medium">Setting</th>
            <th className="py-1 pr-3 font-medium">Passing</th>
            <th className="py-1 pr-3 font-medium">Cost</th>
            <th className="py-1 pr-3 font-medium">Per run</th>
            <th className="py-1 pr-3 font-medium">Time per run</th>
            {result.cases.map((c) => (
              <th key={c.case} className="py-1 pr-3 font-medium normal-case" title={c.case}>{c.case.length > 18 ? `${c.case.slice(0, 17)}…` : c.case}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.configs.map((c, i) => (
            <tr key={c.label} className="border-t border-line-faint">
              <td className="py-1.5 pr-3 font-mono text-fg">{c.label}</td>
              <td className="py-1.5 pr-3">
                <Badge variant={c.rate !== null && c.rate === best ? "success" : "default"}>{pct(c.rate)}</Badge>{" "}
                <span className="text-fg-muted">{c.passed}/{c.trials - c.notRun}{c.notRun ? ` (${c.notRun} not run)` : ""}</span>
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{usd(c.costUsd)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{usd(c.avgCostUsd)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{c.avgSecs === null ? "—" : `${c.avgSecs}s`}</td>
              {result.cases.map((row) => (
                <td key={row.case} className={`py-1.5 pr-3 tabular-nums ${row.passed[i] < row.trials[i] ? "text-red-700" : "text-fg-secondary"}`}>
                  {row.passed[i]}/{row.trials[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-fg-subtle">
        Judge: {result.judge.model}{result.judge.effort ? ` · ${result.judge.effort}` : ""} · spent ${result.spentUsd.toFixed(2)} of ${result.maxUsd.toFixed(2)} · cost includes the judges
        {result.configs[0]?.runIds[0] && (
          <> · e.g. <Link href={runHref(workspace, result.configs[0].runIds[0], tenant)} className="text-accent hover:underline">a run</Link></>
        )}
      </p>
    </div>
  );
}
