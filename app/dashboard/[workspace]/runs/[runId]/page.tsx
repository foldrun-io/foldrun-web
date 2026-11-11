// One run, on a page of its own. Everything about it, in the order a person
// asks: what was this and how did it end; if it went wrong, where and what to
// do next (rerun, approve, answer, the doctor); how this flow has been doing;
// then the run itself — timeline, trace, steps, the browser. Older and newer
// runs are an arrow key away.
//
// UI refactor (Nov 2026): the header, the callout and the facts are drawn by
// LiveRun from the stream, so the outcome and the actions change the moment
// the run does; this page hands it what only the server knows.

import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listRuns, listRunOutputs, readRun, runCost, runTokens, measuredHitRate, runDisplayStatus, runFailure, runVerdict } from "@/lib/store";
import { LiveRun } from "../../live-run";
import { OUTCOME, outcomeOf, tally } from "@/components/outcome-model";
import { Status } from "@/components/status";
import { runHref } from "@/components/run-href";
import { runLite } from "@/server/run-lite";
import { runCharges, runCharge } from "@/server/run-charges";
import { credits } from "@/components/money";
import { RunPageKeys } from "@/components/run-page-nav";
import { LocalTime } from "@/components/local-time";
import { fmtSpan } from "@/components/mission-model";
import { fmtTokenDetail, fmtTokenLine } from "@/components/step-io-model";
import { Page, IconBox, Fact, Tag, Panel } from "@foldrun/ui/react/page";
import { buttonVariants } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Bot, ChevronLeft, ChevronRight, FlaskConical, Workflow } from "lucide-react";
import { gradesOfRun } from "@/lib/grades";
import { WithEmails } from "@/components/email";
import { anchorId } from "@/components/collapse-model";
import { listApiKeys } from "@/server/auth";
import { a2aKeyLabels, a2aRunLabel } from "@/components/a2a-model";
import { conversationNote } from "@/components/conversation-model";
import { fileSize } from "@/components/run-inputs-model";
import { RUN_INPUTS_PREFIX } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; runId: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace, runId } = await params;
  const { tenant = "default" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();
  const run = readRun(tenant, workspace, runId);
  if (!run) notFound();

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const all = listRuns(tenant, workspace); // newest first
  const at = all.findIndex((r) => r.id === run.id);
  const newer = at > 0 ? all[at - 1] : null;
  const older = at >= 0 && at < all.length - 1 ? all[at + 1] : null;
  const charges = await runCharges(tenant);
  const same = all.filter((r) => r.flow === run.flow).slice(0, 40).reverse().map((r) => runLite({ ...r, workspace }, charges));

  // A run an outside agent started: "A2A · <key label>" (1 Nov 2026).
  const a2aLabel = run.a2a || run.trigger === "a2a" ? a2aRunLabel(run, a2aKeyLabels(await listApiKeys(tenant))) : null;
  const status = runDisplayStatus(run);
  const verdict = run.status === "completed" ? runVerdict(run) : null;
  const outcome = outcomeOf(status, verdict);
  const failure = runFailure(run);
  const cost = runCost(run);
  const tokens = runTokens(run);
  const what = run.flow.startsWith("adhoc:") ? run.flow.slice(6) : run.flow.startsWith("eval:") ? run.flow.slice(5) : run.flow;
  const kind = run.flow.startsWith("adhoc:") ? "agent" : run.flow.startsWith("eval:") ? "eval" : "flow";
  const listHref = `/dashboard/${workspace}/runs${qs}`;
  const olderHref = older ? runHref(workspace, older.id, tenant) : null;
  const newerHref = newer ? runHref(workspace, newer.id, tenant) : null;
  const headline = run.summary?.trim() || null;
  // What the graders (evals with trigger: runs) said about this run.
  let grades: ReturnType<typeof gradesOfRun> = [];
  try {
    grades = gradesOfRun(tenant, workspace, run.id);
  } catch {
    /* a grader that cannot be read grades nothing here */
  }

  const Kind = kind === "agent" ? Bot : kind === "eval" ? FlaskConical : Workflow;
  const charged = charges.usd.has(run.id);
  const tokenLine = fmtTokenLine(tokens, measuredHitRate(run.steps.map((s) => s.tokens)));
  const navButton = (href: string | null, label: string, Icon: typeof ChevronLeft, keyHint: string) =>
    href ? (
      <Tooltip label={`${label} (${keyHint})`}>
        <Link href={href} aria-label={label} className={buttonVariants({ variant: "secondary", size: "icon" })}>
          <Icon aria-hidden />
        </Link>
      </Tooltip>
    ) : (
      <span aria-hidden className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "pointer-events-none opacity-40")}>
        <Icon />
      </span>
    );

  // How this flow has been doing: its recent runs, this one ringed — a fact
  // beside the others, not a section of its own.
  const history =
    same.length > 1 ? (
      <span className="flex flex-wrap items-center gap-[3px] py-0.5">
        {same.map((r) => (
          <Tooltip
            key={r.id}
            label={
              <>
                {OUTCOME[r.outcome].hint} · {r.startedAt.slice(0, 16).replace("T", " ")} UTC
                {r.headline ? <><br />{r.headline}</> : null}
              </>
            }
          >
            <Link
              href={runHref(workspace, r.id, tenant)}
              aria-label={`${OUTCOME[r.outcome].hint} · ${r.startedAt.slice(0, 16).replace("T", " ")} UTC`}
              className={cn(
                "h-4 w-2.5 rounded-[2px] transition-transform",
                OUTCOME[r.outcome].cell,
                r.id === run.id ? "ring-2 ring-fg ring-offset-1 ring-offset-surface" : "hover:scale-y-125",
              )}
            />
          </Tooltip>
        ))}
      </span>
    ) : null;
  // The shared completion rate (core outcome.ts).
  const sameTally = tally(same.map((r) => r.outcome));

  // What the graders (evals with trigger: runs) said about this run: one
  // line per grader, the first check that did not pass when one did not.
  // FOL-163: the files the run was handed, each linked to the copy held for
  // it — what it read, whatever the storage file is now.
  const inputsPanel = run.inputs?.length ? (
    <Panel title={`Inputs · ${run.inputs.length}`} flush>
      <ul className="divide-y divide-line">
        {run.inputs.map((f) => (
          <li key={f.path} className="flex items-baseline gap-2 px-4 py-2 text-[13px]">
            <Link
              href={`/api/workspaces/${encodeURIComponent(workspace)}/storage/download?path=${encodeURIComponent(`${RUN_INPUTS_PREFIX}${run.id}/${f.path}`)}${tenant !== "default" ? `&tenant=${encodeURIComponent(tenant)}` : ""}`}
              className="min-w-0 flex-1 truncate font-mono text-fg hover:underline"
            >
              {f.path}
            </Link>
            <span className="shrink-0 text-xs text-fg-subtle">{f.mime}</span>
            <span className="shrink-0 tabular-nums text-xs text-fg-subtle">{fileSize(f.size)}</span>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-[11px] text-fg-subtle">As they were when the run started — handed to its first step in inputs/.</p>
    </Panel>
  ) : null;
  const gradesPanel =
    grades.length > 0 ? (
      <Panel title="Graded" flush>
        <ul className="divide-y divide-line">
          {grades.map((g) => {
            const miss = g.checks.find((c) => !c.passed);
            const why = miss ? (miss.error ?? miss.assertions.find((a) => !a.passed)?.detail ?? "") : "";
            return (
              <li key={g.eval} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 text-[13px]">
                <Status outcome={g.status === "pass" ? "good" : g.status === "fail" ? "failed" : "queued"} label={g.status === "pass" ? "pass" : g.status === "fail" ? "fail" : "not decided"} />
                <Link href={`/dashboard/${workspace}/evals${qs}#${anchorId("eval", g.eval)}`} className="font-medium text-fg hover:underline">
                  {g.eval}
                </Link>
                {miss && (
                  <span className="text-fg-secondary">
                    <WithEmails text={`${miss.name}: ${why}`} />
                  </span>
                )}
                <span className="basis-full text-xs text-fg-muted">
                  {g.by === "sample" ? "sampled" : <>asked by <WithEmails text={g.by} /></>} · {g.at.slice(0, 16).replace("T", " ")} UTC
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    ) : null;

  return (
    <Page width="wide" className="pb-12">
      <RunPageKeys older={olderHref} newer={newerHref} list={listHref} />
      <LiveRun
        key={run.id}
        compactHeader
        workspace={workspace}
        tenant={tenant}
        initial={run}
        outputs={listRunOutputs(tenant, workspace, run.id)}
        page={{
          back: { href: listHref, label: "Runs" },
          icon: (
            <IconBox className="size-10">
              <Kind />
            </IconBox>
          ),
          title: what,
          tags: a2aLabel ? (
            <Tooltip label="Started by an outside agent over A2A, with this A2A key">
              <span>
                <Tag>{a2aLabel}</Tag>
              </span>
            </Tooltip>
          ) : undefined,
          // What it concluded, when the callout below does not already say.
          description: headline && !failure && outcome !== "blocked" && outcome !== "bad" ? <span className="line-clamp-3 break-words">{headline}</span> : undefined,
          meta: (
            <>
              <Fact label={kind === "agent" ? "Agent run" : kind === "eval" ? "Eval run" : "Flow run"}>
                <span className="font-mono">{run.id}</span>
              </Fact>
              {run.revision && (
                <Tooltip label={`deployed commit ${run.revision} — the files this run ran`}>
                  <span>
                    <Fact label="Ran on">
                      <span className="font-mono">{run.revision.slice(0, 7)}</span>
                    </Fact>
                  </span>
                </Tooltip>
              )}
              {run.context && (
                <Tooltip label={conversationNote(run)}>
                  <span>
                    <Fact label="Conversation">
                      <Link href={`/dashboard/${encodeURIComponent(workspace)}/runs?tenant=${encodeURIComponent(tenant)}&context=${encodeURIComponent(run.context.id)}`} className="font-mono">
                        {run.context.id.length > 32 ? `${run.context.id.slice(0, 31)}…` : run.context.id}
                      </Link>
                    </Fact>
                  </span>
                </Tooltip>
              )}
              {run.customer && (
                <Tooltip label="Which of your own users this run is for — its limits and blocks follow it (Settings → API keys → Customers)">
                  <span>
                    <Fact label="Customer">
                      <Link href={`/dashboard/${encodeURIComponent(workspace)}/runs?tenant=${encodeURIComponent(tenant)}&customer=${encodeURIComponent(run.customer)}`} className="font-mono">
                        {run.customer.length > 32 ? `${run.customer.slice(0, 31)}…` : run.customer}
                      </Link>
                    </Fact>
                  </span>
                </Tooltip>
              )}
              {run.drivenAt && (
                <Tooltip label="from the run being created to a worker picking it up">
                  <span>
                    <Fact label="Queued">{fmtSpan(Math.max(0, Date.parse(run.drivenAt) - Date.parse(run.startedAt)))}</Fact>
                  </span>
                </Tooltip>
              )}
              <span className="hidden text-xs text-fg-subtle lg:inline">
                <kbd className="rounded border border-line px-1 font-mono">←</kbd> <kbd className="rounded border border-line px-1 font-mono">→</kbd> older and newer runs ·{" "}
                <kbd className="rounded border border-line px-1 font-mono">u</kbd> the list
              </span>
            </>
          ),
          nav: (
            <span className="flex items-center gap-1">
              {navButton(olderHref, "Older run", ChevronLeft, "←")}
              {navButton(newerHref, "Newer run", ChevronRight, "→")}
            </span>
          ),
          facts: [
            { label: "Started", value: <LocalTime iso={run.startedAt} options={{ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }} /> },
            {
              label: charged ? "Charged" : "Est. charge",
              value: (
                <Tooltip label={`${charged ? "What the ledger charged" : "List price — the run is not settled yet"}${cost ? ` · token cost $${cost.toFixed(4)}` : ""}`}>
                  <span className="tabular-nums">
                    {runCharge(run, charges) ? credits(runCharge(run, charges)) : "—"}
                  </span>
                </Tooltip>
              ),
            },
            { label: "Tokens", value: <Tooltip label={fmtTokenDetail(tokens)}><span className="tabular-nums">{tokenLine ?? "—"}</span></Tooltip> },
            ...(history
              ? [{ label: <>Last {same.length} runs{sameTally.completedPct === null ? "" : ` · ${sameTally.completedPct}% completed`}</>, value: history }]
              : []),
          ],
          failure: failure ? { agent: failure.agent, message: failure.message, fix: failure.fix ?? null, reason: failure.reason } : null,
          extra: inputsPanel || gradesPanel ? (
            <>
              {inputsPanel}
              {gradesPanel}
            </>
          ) : null,
        }}
      />
    </Page>
  );
}
