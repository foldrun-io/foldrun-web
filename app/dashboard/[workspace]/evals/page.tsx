// Evals — the answer to "did that prompt edit make things worse?"
//
// Every other page here tells you what happened. This is the only one that
// tells you whether it was any good. The list is every eval that runs cases,
// then the graders that read real runs; `?eval=<name>` opens one on its own.

import fs from "node:fs";
import { notFound } from "next/navigation";
import { FlaskConical, Gauge } from "lucide-react";
import { workspaceDir, listAgents } from "@/lib/store";
import { listEvals, readEvalResult } from "@/lib/evals";
import { listFlows } from "@/lib/store";
import { CreateButton } from "@/components/create";
import { Page, PageHeader, EmptyState, Chip, Tag, ResourceCard, type Tone } from "@foldrun/ui/react/page";
import { ResourceList, type Row } from "@foldrun/ui/react/list";
import { EvalDetail } from "./eval-card";
import { EvalAnchor, EvalRunButton } from "./eval-actions";
import { currentEvalRun } from "@/server/eval-runs";
import { readGrades, summariseGrades } from "@/lib/grades";
import { GraderDetail } from "./grader-card";
import { nowMs } from "@/components/overview-model";
import { Proposals } from "./proposals";
import { listProposals, settleProposal, unreviewedGrades, type Proposal } from "@/platform/improve";

export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const rateTone = (rate: number | null): Tone => (rate === null ? "default" : rate >= 0.9 ? "good" : rate >= 0.7 ? "warn" : "bad");

export default async function EvalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; eval?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", eval: open } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  // A flow's saved inputs (`inputs: true`) live in evals/ but test nothing;
  // they are on the flow's card, under Run with…, not here.
  const all = listEvals(tenant, workspace).filter((e) => !e.inputs);
  // Graders (`trigger: runs`) read real runs instead of running cases; they
  // get their own section and view.
  const graders = all.filter((e) => e.trigger === "runs");
  const evals = all.filter((e) => e.trigger !== "runs");
  const now = nowMs();
  // Proposed fixes, each eval's own, settled as they are read.
  const proposals = await Promise.all((await listProposals(tenant, workspace).catch(() => [] as Proposal[])).map((p) => settleProposal(tenant, p).catch(() => p)));
  const proposalsOf = (name: string) => proposals.filter((p) => p.eval === name);
  const gradesOf = (name: string) => {
    const month = readGrades(tenant, workspace, name, { sinceMs: now - 30 * 86400_000 });
    const week = month.filter((x) => Date.parse(x.at) >= now - 7 * 86400_000);
    return { month, summary: summariseGrades(month), week: summariseGrades(week) };
  };
  const agents = listAgents(tenant, workspace).map((a) => a.name);
  const flowInfos = listFlows(tenant, workspace);
  const flows = flowInfos.map((f) => f.name);
  const known = new Set([...agents, ...flows]);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const listHref = `/dashboard/${workspace}/evals${qs}`;
  const evalHref = (name: string) => `/dashboard/${workspace}/evals?eval=${encodeURIComponent(name)}${amp}`;
  const targetHref = (e: (typeof all)[number]) =>
    e.flow ? `/dashboard/${workspace}/flows?flow=${encodeURIComponent(e.flow)}${amp}` : `/dashboard/${workspace}/agents/${encodeURIComponent(e.agent ?? "")}${qs}`;

  // One eval, on its own.
  const chosen = open ? all.find((e) => e.name === open) : undefined;
  if (chosen) {
    const target = chosen.flow ?? chosen.agent;
    const missingTarget = !!target && !known.has(target);
    if (chosen.trigger === "runs") {
      const d = gradesOf(chosen.name);
      return (
        <GraderDetail
          workspace={workspace}
          tenant={tenant}
          info={chosen}
          summary={d.summary}
          week={d.week}
          grades={d.month.slice(0, 50)}
          listHref={listHref}
          targetHref={targetHref(chosen)}
          missingTarget={missingTarget}
          extra={
            <Proposals
              key={`proposals-${chosen.name}`}
              workspace={workspace}
              tenant={tenant}
              evalName={chosen.name}
              proposals={proposalsOf(chosen.name)}
              canPropose={unreviewedGrades(d.month, proposals, chosen.name).length > 0}
            />
          }
        />
      );
    }
    // An eval that runs cases: its proposals, and Propose a fix while its
    // last result has a failed case.
    const last = readEvalResult(tenant, workspace, chosen.name);
    const mine = proposalsOf(chosen.name);
    const failing = !!last && last.cases.some((c) => !c.passed);
    const holder = await currentEvalRun(tenant, workspace, chosen.name).catch(() => null);
    // Each flow's agents, for comparing one agent's steps of a flow eval alone.
    const flowAgents = chosen.flow ? [...new Set((flowInfos.find((f) => f.name === chosen.flow)?.steps ?? []).map((s) => s.agent).filter(Boolean))] : null;
    return (
      <EvalDetail
        workspace={workspace}
        tenant={tenant}
        info={chosen}
        last={last}
        listHref={listHref}
        targetHref={targetHref(chosen)}
        missingTarget={missingTarget}
        runningSince={holder?.startedAt ?? null}
        flowAgents={flowAgents}
        proposals={failing || mine.length ? <Proposals key={`proposals-${chosen.name}`} workspace={workspace} tenant={tenant} evalName={chosen.name} proposals={mine} canPropose={failing} /> : null}
      />
    );
  }

  // The list: the evals that run cases, then the graders.
  const targetCell = (e: (typeof all)[number]) => {
    const target = e.flow ?? e.agent ?? "";
    const kind = e.flow ? "flow" : "agent";
    return known.has(target) ? (
      <span>
        <span className="text-fg-muted">{kind}</span> {target}
      </span>
    ) : (
      <Chip tone="bad">
        {kind} &quot;{target}&quot; not found
      </Chip>
    );
  };

  const holders = new Map(await Promise.all(evals.map(async (e) => [e.name, await currentEvalRun(tenant, workspace, e.name).catch(() => null)] as const)));
  const caseRows: Row[] = evals.map((e) => {
    const last = readEvalResult(tenant, workspace, e.name);
    const cases = `${e.cases.length} case${e.cases.length === 1 ? "" : "s"}`;
    const running = holders.get(e.name);
    const verdict = last ? (
      last.error ? (
        <Chip tone="bad">could not run</Chip>
      ) : (
        <Chip tone={last.failed === 0 ? "good" : "bad"}>
          {last.passed}/{last.passed + last.failed} passing
        </Chip>
      )
    ) : running ? (
      <Chip tone="info">running</Chip>
    ) : (
      <span className="text-fg-subtle">never run</span>
    );
    const open = proposalsOf(e.name).filter((p) => p.status === "ready").length;
    return {
      key: e.file,
      search: [e.name, e.file, e.flow ?? e.agent ?? "", e.model].join(" "),
      href: evalHref(e.name),
      icon: <FlaskConical />,
      name: e.name,
      sub: `${cases}${e.trigger === "manual" ? " · runs when you press Run" : ""}${open ? ` · ${open} fix${open === 1 ? "" : "es"} to review` : ""}`,
      cells: {
        target: targetCell(e),
        judge: <Tag mono>{e.model}</Tag>,
        last: verdict,
        cost: last ? `$${last.costUsd.toFixed(4)}` : undefined,
      },
      action: <EvalRunButton workspace={workspace} tenant={tenant} name={e.name} />,
      card: (
        <ResourceCard
          href={evalHref(e.name)}
          icon={<FlaskConical />}
          name={e.name}
          sub={`${e.flow ? "flow" : "agent"} ${e.flow ?? e.agent ?? ""}`}
          status={last ? (last.failed === 0 && !last.error ? "live" : "error") : "idle"}
          statusLabel={last ? `${last.passed}/${last.passed + last.failed} passing` : "never run"}
          lines={[cases, `judge ${e.model}`, last ? `$${last.costUsd.toFixed(4)} last run` : "never run"]}
        />
      ),
    };
  });

  const graderRows: Row[] = graders.map((g) => {
    const d = gradesOf(g.name);
    return {
      key: g.file,
      search: [g.name, g.file, g.flow ?? g.agent ?? "", g.model].join(" "),
      href: evalHref(g.name),
      icon: <Gauge />,
      name: g.name,
      sub: `grades ${g.sample}% of real runs${g.problems.length ? " · cannot be read" : ""}`,
      cells: {
        target: targetCell(g),
        judge: <Tag mono>{g.model}</Tag>,
        last: d.summary.graded > 0 ? <Chip tone={rateTone(d.week.rate)}>{pct(d.week.rate)} · 7 days</Chip> : <span className="text-fg-subtle">none graded yet</span>,
        cost: d.summary.graded > 0 ? `$${d.summary.costUsd.toFixed(4)}` : undefined,
      },
      card: (
        <ResourceCard
          href={evalHref(g.name)}
          icon={<Gauge />}
          name={g.name}
          sub={`${g.flow ? "flow" : "agent"} ${g.flow ?? g.agent ?? ""}`}
          status={d.summary.graded === 0 ? "idle" : (d.week.rate ?? 1) >= 0.9 ? "live" : "error"}
          statusLabel={d.summary.graded > 0 ? `${pct(d.week.rate)} passing, 7 days` : "none graded yet"}
          lines={[`grades ${g.sample}% of runs`, `judge ${g.model}`, `${d.summary.graded} graded in 30 days`]}
        />
      ),
    };
  });

  const create = <CreateButton kind="evals" tenant={tenant} workspace={workspace} />;

  return (
    <Page>
      <EvalAnchor names={all.map((e) => e.name)} proposals={proposals.map((p) => ({ id: p.id, eval: p.eval }))} tenant={tenant} />
      <PageHeader
        title="Evals"
        description="Tests for agents and flows: cases you write, or a grader that checks a sample of real runs."
        actions={create}
      />
      {all.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title="No evals in this workspace yet"
          description="Add evals/<name>.md naming an agent or flow, with one ## section per case. Without one, there's no way to tell whether a prompt edit made things better or worse."
          action={create}
        />
      ) : (
        <ResourceList
          id="evals"
          search="Search evals…"
          nameHeader="Eval"
          columns={[
            { key: "target", header: "Tests", hide: "md" },
            { key: "judge", header: "Judge", hide: "lg" },
            { key: "last", header: "Passing", hide: "sm" },
            { key: "cost", header: "Last cost", align: "end", hide: "lg" },
          ]}
          rows={[...caseRows, ...graderRows]}
        />
      )}
    </Page>
  );
}
