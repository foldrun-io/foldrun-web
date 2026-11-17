"use client";

// One eval's own view (?eval=<name>): its cases and the last result, Run,
// Compare models, its proposed fixes and its file. Running waits for every
// case — a partial verdict is worse than waiting.

import { $rich, $t } from "@/i18n";
import { useState } from "react";
import type React from "react";
import Link from "@foldrun/ui/react/link";
import { useRouter } from "next/navigation";
import { Check, Circle, FlaskConical, X } from "lucide-react";
import { Page, PageHeader, IconBox, Panel, PanelList, SummaryCard, Chip, Tag } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
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
        back={{ href: listHref, label: $t("workspace.evals-eval-card.evals") }}
        icon={
          <IconBox>
            <FlaskConical />
          </IconBox>
        }
        title={info.name}
        badge={
          <>
            {result && <Chip tone={result.failed === 0 ? "good" : "bad"}>{$t("workspace.evals-eval-card.passing", { passed: String(result.passed), passed2: String(result.passed + result.failed) })}</Chip>}
            {result?.error && <Chip tone="bad">{$t("workspace.evals-eval-card.couldNotRun")}</Chip>}
            {info.trigger === "manual" && (
              <Tooltip label={$t("workspace.evals-eval-card.notRunAfterADeployA")}>
                <span>
                  <Tag>{$t("workspace.evals-eval-card.manual")}</Tag>
                </span>
              </Tooltip>
            )}
          </>
        }
        description={
          <>
            {$rich("workspace.evals-eval-card.testsWith", { kind: kind, target: target, span: (chunks) => <span className="font-medium text-fg">{chunks}</span>, cases: cases })}
          </>
        }
        actions={
          <>
            {info.cases.length > 0 && (
              <Tooltip label={canRun ? $t("workspace.evals-eval-card.runTheCasesUnderTwoTo") : $t("workspace.evals-eval-card.theComparisonsRunSoFar")}>
                <Button variant="secondary" size="md" onClick={() => setComparing((v) => !v)} aria-expanded={comparing}>
                  {comparing ? $t("workspace.evals-eval-card.closeCompare") : canRun ? $t("workspace.evals-eval-card.compareModels") : $t("workspace.evals-eval-card.comparisons")}
                </Button>
              </Tooltip>
            )}
            <Button variant="primary" size="md" onClick={run} disabled={busy}>
              {busy ? "Running…" : $t("workspace.evals-eval-card.run")}
            </Button>
            <EvalMenu workspace={workspace} tenant={tenant} file={info.file} listHref={listHref} confirmText={$t("workspace.evals-eval-card.deleteEvalItsPassFailHistory", { name: String(info.name) })} />
          </>
        }
      />

      <div className="space-y-8 pb-12">
        {(error || (result?.error && !busy) || (!busy && runningSince) || busy || missingTarget) && (
          <div className="space-y-1.5 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            {missingTarget && <p className="text-danger">{$t("workspace.evals-eval-card.notFoundInThisTerm", { kind: kind, target: target })}</p>}
            {error && <p className="text-danger">{error}</p>}
            {result?.error && !busy && (
              // The eval never got to its cases. Say why, or 0/n looks like n
              // wrong answers and someone rewrites a working agent.
              <p className="text-danger">{$t("workspace.evals-eval-card.couldNotRun2", { error: result.error })}</p>
            )}
            {!busy && runningSince && <p className="text-fg-muted">{$t("workspace.evals-eval-card.alreadyRunningSinceUtcItsResult", { slice: runningSince.slice(11, 16) })}</p>}
            {busy && (
              <p className="text-fg-muted">
                {$t("workspace.evals-eval-card.runningEachOneStartsAReal", { cases: cases })}
              </p>
            )}
          </div>
        )}

        <SummaryCard
          items={[
            {
              label: kind === "flow" ? $t("workspace.evals-eval-card.flow") : $t("workspace.evals-eval-card.agent"),
              value: missingTarget ? (
                <span className="text-danger">{target}</span>
              ) : (
                <Link href={targetHref} className="hover:underline">
                  {target}
                </Link>
              ),
            },
            { label: $t("workspace.evals-eval-card.judge"), value: <span className="font-mono">{info.model}</span> },
            { label: $t("workspace.evals-eval-card.runs"), value: info.trigger === "manual" ? $t("workspace.evals-eval-card.whenYouPressRun") : $t("workspace.evals-eval-card.afterEveryDeploy") },
            { label: $t("workspace.evals-eval-card.lastRun"), value: result ? result.finishedAt.slice(0, 16).replace("T", " ") : $t("workspace.evals-eval-card.never") },
            { label: $t("workspace.evals-eval-card.cost"), value: result ? `$${result.costUsd.toFixed(4)}` : "—" },
          ]}
        />

        {comparing && (
          <Panel title={$t("workspace.evals-eval-card.compareModels")}>
            <ComparePanel workspace={workspace} tenant={tenant} evalName={info.name} cases={info.cases.length} flowAgents={info.flow ? flowAgents : null} canStart={canRun} />
          </Panel>
        )}

        <Panel title={$t("workspace.evals-eval-card.cases")} description={$t("workspace.evals-eval-card.eachCaseRunsTheAgentOn")} flush>
          {info.cases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">{$t("workspace.evals-eval-card.noCasesYetOneSectionPer")}</p>
          ) : (
            <PanelList>
              {info.cases.map((c) => {
                const r = byName.get(c.name);
                return (
                  <li key={c.name} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {r ? <Chip tone={r.passed ? "good" : "bad"}>{r.passed ? "pass" : "fail"}</Chip> : <Chip>{$t("workspace.evals-eval-card.notRun")}</Chip>}
                      <span className="text-sm font-medium text-fg">{c.name}</span>
                    </div>
                    <p className="text-sm text-fg-muted">{c.task}</p>
                    <ul className="space-y-1">
                      {c.expect.map((a, i) => {
                        const ar = r?.assertions[i];
                        return (
                          <li key={i} className="flex items-start gap-2 text-[13px]">
                            <span className="mt-0.5 shrink-0" aria-label={!ar ? $t("workspace.evals-eval-card.notRun") : ar.passed ? "passed" : "failed"}>
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
          <Panel title={$t("workspace.evals-eval-card.proposedFixes")} description={$t("workspace.evals-eval-card.theAssistantReadsTheFailuresAnd")}>
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
      <h2 className="px-1 text-base font-medium text-fg">{$t("workspace.evals-eval-card.source")}</h2>
      <CollapsibleCard
        id={anchorId("eval-source", name)}
        scope={`eval-source:${workspace}`}
        item={name}
        title={<span className="font-mono text-[13px] font-normal">{$t("workspace.evals-eval-card.evals2", { file: file })}</span>}
        subtitle={$t("workspace.evals-eval-card.editTheCasesAndChecks")}
        className="!rounded-lg !shadow-none"
        bodyClassName="border-t border-line px-4 pb-4 pt-3"
      >
        <InlineEditor workspace={workspace} tenant={tenant} path={`evals/${file}`} />
      </CollapsibleCard>
    </section>
  );
}
