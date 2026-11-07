"use client";

// The welcome flow's First run: one big Run it, the run's steps moving
// inline while it goes, and a clear ending — it finished (open the run), it
// waits for you (open it to approve), or it stopped (the reason, the
// Doctor, run it again). The run is followed over the same stream the flow
// canvas reads (use-run-overlay.ts: GET runs/<id>/stream); the reason a run
// failed is the server's (runFailure), handed in after the stream's `done`
// refreshes the page.

import Link from "@/components/kit/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Hand, Play, RotateCcw, Stethoscope, TriangleAlert, Workflow } from "lucide-react";
import { useRunOverlay } from "@/app/dashboard/[workspace]/flows/use-run-overlay";
import type { RunLite, RunStepLite } from "@/components/flow-canvas-model";
import { outcomeOf, type Outcome } from "@/components/outcome-model";
import { useCan, needs } from "@/components/role";
import { openAssistant } from "@/components/assistant";
import { issueDoctor } from "@/lib/issues";
import { Button, buttonVariants } from "@/components/kit/button";
import { Status, StatusDot } from "@/components/kit/status";
import { cn } from "@/components/kit/cn";
import { Callout, IconBox } from "@/components/kit/page";
import { Tooltip } from "@/components/kit/tooltip";

export interface FirstRunTarget {
  workspace: string;
  flow: string;
  /** The flow's steps (agent, parallel group), drawn before any run. */
  steps: { agent: string; group: number }[];
  /** Its newest run, as the server last saw it. */
  latest: { lite: RunLite; outcome: Outcome; failure: { agent: string; reason: string } | null } | null;
}

const STEP_OUTCOME: Record<string, Outcome> = { pending: "queued", skipped: "quiet", completed: "done", expanded: "done" };
const stepOutcome = (status: string): Outcome => STEP_OUTCOME[status] ?? outcomeOf(status, null);

export function FirstRun({ tenant, target, noModel, modelHref, onContinue }: { tenant: string; target: FirstRunTarget; noModel: boolean; modelHref: string | null; onContinue: () => void }) {
  const router = useRouter();
  const mayRun = useCan("run:start");
  const [runId, setRunId] = useState<string | null>(target.latest?.lite.id ?? null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const known = target.latest && target.latest.lite.id === runId ? target.latest.lite : null;
  const { run } = useRunOverlay(target.workspace, tenant, runId, known);
  const q = tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : "";
  const runHref = runId ? `/dashboard/${encodeURIComponent(target.workspace)}/runs/${runId}${q}` : null;

  const start = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(target.workspace)}/flows/${encodeURIComponent(target.flow)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      // overlap: skip answers 409 with the live run's id — follow that one.
      if (body.runId) setRunId(body.runId);
      else setRefused(body.error ?? `refused (${res.status})`);
      router.refresh();
    } catch (err) {
      setRefused(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const status = run?.status ?? null;
  const outcome: Outcome | null = status ? (status === "completed" && known ? target.latest!.outcome : outcomeOf(status, null)) : null;
  const finished = status === "completed" || status === "failed";
  const failed = status === "failed";
  const failure = failed && known ? target.latest!.failure : null;
  const steps: RunStepLite[] = run?.steps ?? target.steps.map((s) => ({ ...s, status: "pending", costUsd: null }));
  const at = steps.findIndex((s) => s.status === "running" || s.status === "awaiting-approval");
  const doctor = runId ? issueDoctor({ kind: "failed", runs: [{ workspace: target.workspace, id: runId, at: "" }] }) : null;

  return (
    <div className="space-y-5">
      {noModel && !finished && (
        <Callout
          tone="warning"
          icon={<TriangleAlert />}
          actions={
            modelHref && (
              <Link href={modelHref} className="font-medium underline underline-offset-2">
                Add a key
              </Link>
            )
          }
        >
          This account has no model key yet, so the run will stop at its first step — nothing is charged.
        </Callout>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface" aria-label="First run">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <IconBox>
            <Workflow />
          </IconBox>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{target.flow}</p>
            <p className="truncate text-sm text-fg-muted">
              {target.workspace} · {steps.length} step{steps.length === 1 ? "" : "s"}
            </p>
          </div>
          {outcome && <Status outcome={outcome} />}
          {!run && (
            <Tooltip label={mayRun ? undefined : needs("run:start")}>
              <span className="inline-flex max-sm:w-full">
                <Button variant="primary" size="lg" disabled={!mayRun || busy} onClick={() => void start()} className="max-sm:w-full">
                  <Play aria-hidden />
                  {busy ? "Starting…" : "Run it"}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>

        <ol className="border-t border-line">
          {steps.map((s, i) => (
            <li key={`${i}-${s.agent}-${s.item ?? ""}`} className={cn("flex min-w-0 items-center gap-3 px-5 py-2.5 text-sm", i % 2 === 1 && "bg-sunken/60")}>
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-fg-subtle">{s.group}</span>
              <StatusDot outcome={stepOutcome(s.status)} label={s.status} />
              <span className={cn("min-w-0 flex-1 truncate", i === at ? "font-medium text-fg" : "text-fg-secondary")}>{s.agent}</span>
              <span className="shrink-0 text-xs text-fg-muted">{run ? s.status.replace("awaiting-approval", "waiting for you") : ""}</span>
            </li>
          ))}
        </ol>

      </section>

      {refused && (
        <Callout
          tone="danger"
          icon={<TriangleAlert />}
          actions={
            <Button size="sm" onClick={() => setRefused(null)}>
              Dismiss
            </Button>
          }
        >
          Not started: {refused}
        </Callout>
      )}

      {status === "awaiting-approval" && runHref && (
        <Callout
          size="lg"
          tone="neutral"
          icon={<Hand />}
          title="It is waiting for you"
          actions={
            <Link href={runHref} className={buttonVariants({ variant: "primary", size: "md" })}>
              Open the run
            </Link>
          }
        >
          The flow stops at an approval gate before its last step. Open the run, read what it made, and approve or reject it.
        </Callout>
      )}

      {status === "completed" && runHref && (
        <Callout
          size="lg"
          tone="success"
          icon={<CircleCheck />}
          title="Your first run finished"
          actions={
            <>
              <Link href={runHref} className={buttonVariants({ variant: "primary", size: "md" })}>
                Open the run
              </Link>
              <Button size="md" onClick={onContinue}>
                What next
              </Button>
            </>
          }
        >
          Every step ran end to end. The run page has each step&apos;s output, what it cost and the full trace.
        </Callout>
      )}

      {failed && runHref && (
        <Callout
          size="lg"
          tone="danger"
          icon={<TriangleAlert />}
          title="The run stopped"
          actions={
            <>
              {noModel && modelHref && (
                <Link href={modelHref} className={buttonVariants({ variant: "primary", size: "md" })}>
                  Add a model key
                </Link>
              )}
              {doctor && (
                <Button variant={noModel && modelHref ? "secondary" : "primary"} size="md" onClick={() => openAssistant(doctor.prompt, doctor.workspace)}>
                  <Stethoscope aria-hidden />
                  Ask the doctor
                </Button>
              )}
              <Link href={runHref} className={buttonVariants({ size: "md" })}>
                Open the run
              </Link>
              <Button size="md" variant="ghost" disabled={!mayRun || busy} onClick={() => void start()}>
                <RotateCcw aria-hidden />
                Run again
              </Button>
            </>
          }
        >
          {failure ? (
            <>
              <span className="font-medium text-fg">{failure.agent}</span>: {failure.reason}
            </>
          ) : (
            "A step failed. The run page shows which, and why."
          )}
        </Callout>
      )}
    </div>
  );
}
