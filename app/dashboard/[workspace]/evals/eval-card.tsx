"use client";

// One eval, its cases, and the last result. Running is synchronous — the
// button stays busy until every case has finished, because a partial verdict
// is worse than waiting.

import { useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { DeleteButton } from "../../manage";
import { Badge, buttonClass } from "@/components/ui";
import { InlineEditor } from "@/components/inline-editor";
import { ExpandableTitle } from "@/components/expandable";
import { CollapsibleCard, setCardsOpen } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import type { EvalInfo, EvalResult } from "@/lib/evals";
import { ComparePanel } from "./compare-panel";
import { useCan } from "@/components/role";

export function EvalCard({
  workspace,
  tenant,
  info,
  last,
  search,
  runningSince = null,
  flowAgents = null,
  proposals = null,
}: {
  /** Proposed fixes for its failed cases, drawn by the page. */
  proposals?: React.ReactNode;
  /** A flow eval's agents, for comparing one agent's steps alone. */
  flowAgents?: string[] | null;
  /** The text the list search matches, so a match opens the card. */
  search?: string;
  workspace: string;
  tenant: string;
  info: EvalInfo;
  last: EvalResult | null;
  /** When an eval run already going started — shown, not followed. */
  runningSince?: string | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<EvalResult | null>(last);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const canRun = useCan("run:start");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };
      // Started, not waited on: an eval of slow cases outlives the proxy in
      // front of the dashboard (Cloudflare's 100 s), so it runs on and this
      // polls for its result.
      const res = await fetch(`/api/workspaces/${workspace}/evals/${info.name}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ async: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      if (res.status !== 202) {
        setResult(data);
      } else {
        // Polled by this run's id: its own verdict, whatever else runs or
        // writes the latest result meanwhile.
        const runId = encodeURIComponent(String(data.runId ?? ""));
        for (;;) {
          await new Promise((r) => setTimeout(r, 4000));
          const poll = await fetch(`/api/workspaces/${workspace}/evals/${info.name}/run?run=${runId}`, { headers });
          const view = (await poll.json()) as { state?: string; error?: string; result?: EvalResult };
          if (!poll.ok) throw new Error(`could not read the run's state (${view.error ?? poll.status}) — it may still be running; reload to see`);
          if (view.state === "running") continue;
          if (view.state === "done" && view.result) {
            setResult(view.result);
            break;
          }
          throw new Error(view.error ?? `the run ended as ${view.state ?? "unknown"}, with no result`);
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const byName = new Map(result?.cases.map((c) => [c.name, c]));

  return (
    <CollapsibleCard
      id={anchorId("eval", info.name)}
      scope={`evals:${workspace}`}
      item={info.name}
      search={search}
      // A run in progress or one that just failed to start is shown, not
      // hidden behind a chevron.
      forceOpen={busy || !!error || comparing}
      title={info.name}
      meta={
        <>
            <Badge variant="info">{info.flow ? `flow: ${info.flow}` : `agent: ${info.agent}`}</Badge>
            <Badge>
              {info.cases.length} case{info.cases.length === 1 ? "" : "s"}
            </Badge>
            <Badge>judge: {info.model}</Badge>
            {info.trigger === "manual" && (
              <Badge title="Not run after a deploy — a person runs it, because it costs a whole run.">
                manual
              </Badge>
            )}
            {result && (
              <>
                <Badge variant={result.failed === 0 ? "success" : "error"}>
                  {result.passed}/{result.passed + result.failed} passing
                </Badge>
                <Badge>${result.costUsd.toFixed(4)}</Badge>
                {result.error && <Badge variant="error">could not run</Badge>}
              </>
            )}
        </>
      }
      actions={
        <span className="flex shrink-0 items-center gap-3">
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <DeleteButton
              endpoint={`/api/workspaces/${workspace}/source`}
              tenant={tenant}
              body={{ path: `evals/${info.file}` }}
              confirmText={`Delete eval ${info.name}? Its pass/fail history goes with it.`}
            />
          </span>
          {info.cases.length > 0 && (
            <button
              onClick={() => {
                // Open the card too: a card someone collapsed by hand stays shut
                // for forceOpen, and the panel lives inside it.
                if (!comparing) setCardsOpen(`evals:${workspace}`, true, info.name);
                setComparing((v) => !v);
              }}
              className={buttonClass("minimal")}
              title={canRun ? "Run the cases under two to four models, side by side" : "The comparisons run so far"}
            >
              {comparing ? "Close compare" : canRun ? "Compare models" : "Comparisons"}
            </button>
          )}
          <button onClick={run} disabled={busy} className={buttonClass("secondary")}>
            {busy ? "Running…" : "Run"}
          </button>
        </span>
      }
    >
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {result?.error && !busy && (
        // The eval never got to its cases. Say why, or 0/n looks like n
        // wrong answers and someone rewrites a working agent.
        <p className="mb-2 text-xs text-red-600">Could not run: {result.error}</p>
      )}
      {!busy && runningSince && (
        <p className="mb-2 text-xs text-fg-muted">
          Already running, since {runningSince.slice(11, 16)} UTC — its result shows here when you reload after it finishes.
        </p>
      )}
      {busy && (
        <p className="mb-2 text-xs text-fg-muted">
          Running {info.cases.length} case{info.cases.length === 1 ? "" : "s"} — each one starts a
          real run, so this takes as long as the agent does.
        </p>
      )}

      <ul className="space-y-2">
        {info.cases.map((c) => {
          const r = byName.get(c.name);
          return (
            <li key={c.name} className="rounded-lg border border-line bg-sunken/60 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {r ? (
                  <Badge variant={r.passed ? "success" : "error"}>{r.passed ? "pass" : "fail"}</Badge>
                ) : (
                  <Badge>not run</Badge>
                )}
                <span className="text-sm font-medium text-fg">{c.name}</span>
              </div>
              <p className="mt-1 text-xs italic text-fg-muted">{c.task}</p>

              <ul className="mt-1.5 space-y-0.5">
                {c.expect.map((a, i) => {
                  const ar = r?.assertions[i];
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                      <span
                        className={
                          !ar ? "text-gray-300" : ar.passed ? "text-green-600" : "text-red-600"
                        }
                      >
                        {!ar ? "○" : ar.passed ? "✓" : "✗"}
                      </span>
                      <span className="font-mono text-fg-tertiary">{a.type}:</span>
                      <span className="text-fg-secondary">{a.value}</span>
                      {ar && !ar.passed && (
                        <span className="text-red-600">— {ar.detail}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {r?.error && <p className="mt-1 text-xs text-red-600">{r.error}</p>}
            </li>
          );
        })}
      </ul>

      {proposals && <div className="mt-3">{proposals}</div>}

      {comparing && (
        <ComparePanel workspace={workspace} tenant={tenant} evalName={info.name} cases={info.cases.length} flowAgents={info.flow ? flowAgents : null} canStart={canRun} />
      )}

      <div className="mt-3">
        <ExpandableTitle
          open={editing}
          onToggle={() => setEditing((e) => !e)}
          name={`evals/${info.file}`}
        />
      </div>
      {editing && (
        <InlineEditor workspace={workspace} tenant={tenant} path={`evals/${info.file}`} />
      )}
    </CollapsibleCard>
  );
}
