// Evals — the answer to "did that prompt edit make things worse?"
//
// Every other page here tells you what happened. This is the only one that
// tells you whether it was any good.

import { WorkspaceHeader } from "@/components/workspace-header";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents } from "@/lib/store";
import { listEvals, readEvalResult } from "@/lib/evals";
import { listFlows } from "@/lib/store";
import { CreateButton } from "@/components/create";
import { Badge, EmptyScreen, PageHeader } from "@/components/ui";
import { ListSearch } from "@/components/list-search";
import { CollapseAll } from "@/components/collapsible-card";
import { EvalCard } from "./eval-card";
import { currentEvalRun } from "@/server/eval-runs";
import { readGrades, summariseGrades } from "@/lib/grades";
import { GraderCard } from "./grader-card";
import { nowMs } from "@/components/overview-model";
import { Proposals } from "./proposals";
import { listProposals, settleProposal, unreviewedGrades, type Proposal } from "@/platform/improve";

export const dynamic = "force-dynamic";

export default async function EvalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  // A flow's saved inputs (`inputs: true`) live in evals/ but test nothing;
  // they are on the flow's card, under Run with…, not here.
  const all = listEvals(tenant, workspace).filter((e) => !e.inputs);
  // Graders (`trigger: runs`) read real runs instead of running cases; they
  // get their own section and card.
  const graders = all.filter((e) => e.trigger === "runs");
  const evals = all.filter((e) => e.trigger !== "runs");
  const now = nowMs();
  // Proposed fixes, each eval's own, settled as they are read.
  const proposals = await Promise.all((await listProposals(tenant, workspace).catch(() => [] as Proposal[])).map((p) => settleProposal(tenant, p).catch(() => p)));
  const proposalsOf = (name: string) => proposals.filter((p) => p.eval === name);
  // An eval that runs cases: its proposals, and Propose a fix while its
  // last result has a failed case. Built here, as an element, before the JSX.
  const caseProposals = (name: string) => {
    const last = readEvalResult(tenant, workspace, name);
    const mine = proposalsOf(name);
    const failing = !!last && last.cases.some((c) => !c.passed);
    return failing || mine.length ? <Proposals key={`proposals-${name}`} workspace={workspace} tenant={tenant} evalName={name} proposals={mine} canPropose={failing} /> : null;
  };
  const graded = new Map(
    graders.map((g) => {
      const month = readGrades(tenant, workspace, g.name, { sinceMs: now - 30 * 86400_000 });
      const week = month.filter((x) => Date.parse(x.at) >= now - 7 * 86400_000);
      return [g.name, { month, summary: summariseGrades(month), week: summariseGrades(week) }] as const;
    }),
  );
  // An eval already running (started here, from the CLI, or before a refresh).
  const holders = new Map(await Promise.all(evals.map(async (e) => [e.name, await currentEvalRun(tenant, workspace, e.name).catch(() => null)] as const)));
  const agents = listAgents(tenant, workspace).map((a) => a.name);
  const flowInfos = listFlows(tenant, workspace);
  const flows = flowInfos.map((f) => f.name);
  // Each flow's agents, for comparing one agent's steps of a flow eval alone.
  const flowAgents = new Map<string, string[]>(flowInfos.map((f) => [f.name, [...new Set(f.steps.map((s) => s.agent).filter(Boolean))]]));
  const known = new Set([...agents, ...flows]);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Evals"
        subtitle="Tests for agents. An eval asserts properties of the output — contains, produces a file, a judge agrees — because exact output changes every run."
      >
        <CreateButton kind="evals" tenant={tenant} workspace={workspace} />
      </PageHeader>

      {graders.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-fg">Grading live runs</h2>
          <p className="mb-3 text-sm text-fg-muted">
            An eval with <code className="text-xs">trigger: runs</code> grades a sample of the real finished runs of its agent or flow against its checks — the runs that happened, not cases someone wrote.
          </p>
          <ul className="space-y-3">
            {graders.map((g) => {
              const d = graded.get(g.name)!;
              const target = g.flow ?? g.agent;
              return (
                <li key={g.file}>
                  {target && !known.has(target) && (
                    <p className="mb-1">
                      <Badge variant="error">{g.flow ? "flow" : "agent"} &quot;{target}&quot; not found</Badge>
                    </p>
                  )}
                  <GraderCard
                    workspace={workspace}
                    tenant={tenant}
                    info={g}
                    summary={d.summary}
                    week={d.week}
                    grades={d.month.slice(0, 50)}
                    extra={
                      <Proposals
                        key={`proposals-${g.name}`}
                        workspace={workspace}
                        tenant={tenant}
                        evalName={g.name}
                        proposals={proposalsOf(g.name)}
                        canPropose={unreviewedGrades(d.month, proposals, g.name).length > 0}
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {evals.length === 0 && graders.length > 0 ? null : evals.length === 0 ? (
        <EmptyScreen
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 11 3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          }
          title="No evals in this workspace yet"
          description="Add evals/<name>.md naming an agent or flow, with one ## section per case. Without one, there's no way to tell whether a prompt edit made things better or worse."
        />
      ) : (
        <>
        <div className="mb-4 flex items-center gap-3">
          <ListSearch listId="evals-list" placeholder="Search evals…" total={evals.length} noun="evals" className="!mb-0 min-w-0 flex-1" />
          <CollapseAll scope={`evals:${workspace}`} />
        </div>
        <ul id="evals-list" className="space-y-3">
          {evals.map((e) => {
            const target = e.flow ?? e.agent;
            return (
              <li key={e.file} data-search={[e.name, e.file, target ?? ""].join(" ")}>
                {target && !known.has(target) && (
                  <p className="mb-1">
                    <Badge variant="error">
                      {e.flow ? "flow" : "agent"} &quot;{target}&quot; not found
                    </Badge>
                  </p>
                )}
                <EvalCard
                  workspace={workspace}
                  tenant={tenant}
                  info={e}
                  search={[e.name, e.file, target ?? ""].join(" ")}
                  last={readEvalResult(tenant, workspace, e.name)}
                  runningSince={holders.get(e.name)?.startedAt ?? null}
                  flowAgents={e.flow ? (flowAgents.get(e.flow) ?? []) : null}
                  proposals={caseProposals(e.name)}
                />
              </li>
            );
          })}
        </ul>
        </>
      )}
    </main>
  );
}
