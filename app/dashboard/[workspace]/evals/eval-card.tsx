"use client";

// One eval's own view (?eval=<name>): its cases and the last result, Run,
// Compare models, its proposed fixes and its file. Running waits for every
// case — a partial verdict is worse than waiting.

import { useState } from "react";
import type React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, FlaskConical, X } from "lucide-react";
import { Page, PageHeader, IconBox, Panel, PanelList, SummaryCard, Chip, Tag } from "@/components/kit/page";
import { Button } from "@/components/kit/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { anchorId } from "@/components/collapse-model";
import { InlineEditor } from "@/components/inline-editor";
import type { EvalInfo, EvalResult } from "@/lib/evals";
import { ComparePanel } from "./compare-panel";
import { EvalMenu } from "./eval-actions";
import { runEval } from "./run-eval";
import { useCan } from "@/components/role";

export function EvalDetail({
  workspace,
  tenant,
  info,
  last,
  listHref,
  targetHref,
  missingTarget = false,
  runningSince = null,
  flowAgents = null,
  proposals = null,
}: {
  workspace: string;
  tenant: string;
  info: EvalInfo;
  last: EvalResult | null;
  /** The Evals list, for the way back and after Delete. */
  listHref: string;
  /** The agent's or flow's page. */
  targetHref: string;
  /** The agent or flow it names is not in this workspace. */
  missingTarget?: boolean;
  /** When an eval run already going started — shown, not followed. */
  runningSince?: string | null;
  /** A flow eval's agents, for comparing one agent's steps alone. */
  flowAgents?: string[] | null;
  /** Proposed fixes for its failed cases, drawn by the page. */
  proposals?: React.ReactNode;
}) {
  const router = useRouter();
  const [result, setResult] = useState<EvalResult | null>(last);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const canRun = useCan("run:start");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await runEval(workspace, tenant, info.name));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const byName = new Map(result?.cases.map((c) => [c.name, c]));
  const kind = info.flow ? "flow" : "agent";
  const target = info.flow ?? info.agent ?? "";
  const cases = `${info.cases.length} case${info.cases.length === 1 ? "" : "s"}`;

  return (
    <Page>
      <PageHeader
        back={{ href: listHref, label: "Evals" }}
        icon={
          <IconBox>
            <FlaskConical />
          </IconBox>
        }
        title={info.name}
        badge={
          <>
            {result && <Chip tone={result.failed === 0 ? "good" : "bad"}>{result.passed}/{result.passed + result.failed} passing</Chip>}
            {result?.error && <Chip tone="bad">could not run</Chip>}
            {info.trigger === "manual" && (
              <span title="Not run after a deploy — a person runs it, because it costs a whole run.">
                <Tag>manual</Tag>
              </span>
            )}
          </>
        }
        description={
          <>
            Tests {kind} <span className="font-medium text-fg">{target}</span> with {cases}.
          </>
        }
        actions={
          <>
            {info.cases.length > 0 && (
              <Button variant="secondary" size="md" onClick={() => setComparing((v) => !v)} aria-expanded={comparing} title={canRun ? "Run the cases under two to four models, side by side" : "The comparisons run so far"}>
                {comparing ? "Close compare" : canRun ? "Compare models" : "Comparisons"}
              </Button>
            )}
            <Button variant="primary" size="md" onClick={run} disabled={busy}>
              {busy ? "Running…" : "Run"}
            </Button>
            <EvalMenu workspace={workspace} tenant={tenant} file={info.file} listHref={listHref} confirmText={`Delete eval ${info.name}? Its pass/fail history goes with it.`} />
          </>
        }
      />

      <div className="space-y-8 pb-12">
        {(error || (result?.error && !busy) || (!busy && runningSince) || busy || missingTarget) && (
          <div className="space-y-1.5 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            {missingTarget && <p className="text-danger">{kind} &quot;{target}&quot; not found in this workspace.</p>}
            {error && <p className="text-danger">{error}</p>}
            {result?.error && !busy && (
              // The eval never got to its cases. Say why, or 0/n looks like n
              // wrong answers and someone rewrites a working agent.
              <p className="text-danger">Could not run: {result.error}</p>
            )}
            {!busy && runningSince && <p className="text-fg-muted">Already running, since {runningSince.slice(11, 16)} UTC — its result shows here when you reload after it finishes.</p>}
            {busy && (
              <p className="text-fg-muted">
                Running {cases} — each one starts a real run, so this takes as long as the agent does.
              </p>
            )}
          </div>
        )}

        <SummaryCard
          items={[
            {
              label: kind === "flow" ? "Flow" : "Agent",
              value: missingTarget ? (
                <span className="text-danger">{target}</span>
              ) : (
                <Link href={targetHref} className="hover:underline">
                  {target}
                </Link>
              ),
            },
            { label: "Judge", value: <span className="font-mono">{info.model}</span> },
            { label: "Runs", value: info.trigger === "manual" ? "When you press Run" : "After every deploy" },
            { label: "Last run", value: result ? result.finishedAt.slice(0, 16).replace("T", " ") : "Never" },
            { label: "Cost", value: result ? `$${result.costUsd.toFixed(4)}` : "—" },
          ]}
        />

        {comparing && (
          <Panel title="Compare models">
            <ComparePanel workspace={workspace} tenant={tenant} evalName={info.name} cases={info.cases.length} flowAgents={info.flow ? flowAgents : null} canStart={canRun} />
          </Panel>
        )}

        <Panel title="Cases" description="Each case runs the agent on a task; each line under it is a check its output must pass." flush>
          {info.cases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">No cases yet — one ## section per case in the file.</p>
          ) : (
            <PanelList>
              {info.cases.map((c) => {
                const r = byName.get(c.name);
                return (
                  <li key={c.name} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {r ? <Chip tone={r.passed ? "good" : "bad"}>{r.passed ? "pass" : "fail"}</Chip> : <Chip>not run</Chip>}
                      <span className="text-sm font-medium text-fg">{c.name}</span>
                    </div>
                    <p className="text-sm text-fg-muted">{c.task}</p>
                    <ul className="space-y-1">
                      {c.expect.map((a, i) => {
                        const ar = r?.assertions[i];
                        return (
                          <li key={i} className="flex items-start gap-2 text-[13px]">
                            <span className="mt-0.5 shrink-0" aria-label={!ar ? "not run" : ar.passed ? "passed" : "failed"}>
                              {!ar ? <Circle className="size-3.5 text-fg-subtle" /> : ar.passed ? <Check className="size-3.5 text-success" /> : <X className="size-3.5 text-danger" />}
                            </span>
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="font-mono text-fg-muted">{a.type}:</span> <span className="text-fg-secondary">{a.value}</span>
                              {ar && !ar.passed && <span className="text-danger"> — {ar.detail}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {r?.error && <p className="text-xs text-danger">{r.error}</p>}
                  </li>
                );
              })}
            </PanelList>
          )}
        </Panel>

        {proposals && (
          <Panel title="Proposed fixes" description="The assistant reads the failures and proposes the smallest change. Nothing is written until you apply it.">
            {proposals}
          </Panel>
        )}

        <EvalSource workspace={workspace} tenant={tenant} name={info.name} file={info.file} />
      </div>
    </Page>
  );
}

/** An eval's file, folded until asked for: the editor loads only when
 *  opened, and the card remembers whether it was. */
export function EvalSource({ workspace, tenant, name, file }: { workspace: string; tenant: string; name: string; file: string }) {
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-base font-medium text-fg">Source</h2>
      <CollapsibleCard
        id={anchorId("eval-source", name)}
        scope={`eval-source:${workspace}`}
        item={name}
        title={<span className="font-mono text-[13px] font-normal">evals/{file}</span>}
        subtitle="Edit the cases and checks"
        className="!rounded-lg !shadow-none"
        bodyClassName="border-t border-line px-4 pb-4 pt-3"
      >
        <InlineEditor workspace={workspace} tenant={tenant} path={`evals/${file}`} />
      </CollapsibleCard>
    </section>
  );
}
