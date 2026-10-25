import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requirePermission } from "@/server/api";
import { loadFlow } from "@/lib/runner";
import { listRunSummaries } from "@/lib/store";
import { enqueueFlowRun, startFlowFromStep } from "@/platform/queue";
import { claimRequestKey, noteRequestRun, releaseRequestKey } from "@/platform/trigger-gate";
import { wantsWait, waitAndRespond } from "@/server/wait";
import { idempotent } from "@/server/idempotency";

async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; flow: string }> },
) {
  try {
    const { workspace, flow: flowName } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const flow = loadFlow(tenant, workspace, flowName);
    if (!flow) return NextResponse.json({ error: `flow ${flowName} not found` }, { status: 404 });
    if (flow.steps.length === 0) {
      return NextResponse.json({ error: `flow ${flowName} has no steps` }, { status: 400 });
    }
    // A run-level task (CLI --task / dashboard input) is delivered to the
    // first step; output passing carries it down the chain from there.
    let task = "";
    let tags: string[] = [];
    let from = 1;
    // { test: true } makes this a test run — see runs.md "Test runs". Left
    // out, the platform decides (a preview workspace's runs are tests).
    let test: boolean | undefined;
    // A caller's own key for this request. A retried start call — a dropped
    // response, a proxy timeout, a CI step that ran twice — otherwise starts
    // a second run and bills for it, and nobody notices until the invoice.
    // Header or body: a retrying HTTP client finds the header easier.
    let idempotencyKey = req.headers.get("idempotency-key")?.trim() || "";
    try {
      const body = await req.json();
      if (typeof body?.task === "string") task = body.task.trim();
      if (Array.isArray(body?.tags)) tags = body.tags.map(String);
      // { from: N } starts at step N of the current flow; the steps before
      // it are recorded as skipped, not invented.
      if (body?.from !== undefined) from = Number(body.from);
      if (typeof body?.test === "boolean") test = body.test;
      if (!idempotencyKey && typeof body?.idempotencyKey === "string") idempotencyKey = body.idempotencyKey.trim();
    } catch {
      // empty body is fine
    }
    const lastStep = Math.max(...flow.steps.map((s) => s.group));
    if (!Number.isInteger(from) || from < 1 || from > lastStep) {
      return NextResponse.json(
        { error: `from must be a step number between 1 and ${lastStep}` },
        { status: 400 },
      );
    }
    if (from > 1 && task) {
      // The task would be stapled to a step that never runs — refuse rather
      // than silently lose it. Checked before the key is claimed, so a
      // refused request never leaves a claim behind.
      return NextResponse.json(
        { error: "task and from can't be combined: the task goes to step 1, which from skips" },
        { status: 400 },
      );
    }
    // overlap: skip holds for a person or a key too, not only the scheduler.
    // A second manual start while one is live is almost always a double
    // click or a retried command, and two copies bill twice and write the
    // same state files at once.
    if (flow.overlap === "skip") {
      const live = listRunSummaries(tenant, workspace).find(
        (r) => r.flow === flow.name && (r.status === "running" || r.status === "queued" || r.status === "awaiting-approval"),
      );
      if (live) {
        return NextResponse.json(
          { error: `${flow.name} is already running (${live.id}) — overlap: skip allows one run at a time`, runId: live.id },
          { status: 409 },
        );
      }
    }
    if (idempotencyKey) {
      // Claimed against a placeholder first: two simultaneous retries must
      // not both find nothing and both start a run. The loser is answered
      // with the winner's id, which is what a retrying client wants.
      const already = await claimRequestKey(tenant, workspace, `run:${flow.name}`, idempotencyKey, "");
      if (already !== null) {
        return NextResponse.json({
          ok: true,
          started: false,
          reason: "duplicate",
          runId: already || undefined,
          detail: `this idempotency-key already started a run of ${flow.name} — no second run`,
        });
      }
    }

    if (from > 1) {
      let run;
      try {
        run = await startFlowFromStep(tenant, workspace, flow.name, from, actor.kind === "user" ? actor.name : null, { test });
      } catch (err) {
        if (idempotencyKey) await releaseRequestKey(tenant, workspace, `run:${flow.name}`, idempotencyKey);
        throw err;
      }
      if (idempotencyKey) await noteRequestRun(tenant, workspace, `run:${flow.name}`, idempotencyKey, run.id);
      if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
      return NextResponse.json({ ok: true, runId: run.id, steps: run.steps.length, from, test: run.test === true });
    }
    const steps = task
      ? flow.steps.map((s, i) =>
          i === 0 ? { ...s, instruction: `${s.instruction}\n\n<run_task>\n${task}\n</run_task>` } : s,
        )
      : flow.steps;
    let run;
    try {
      run = await enqueueFlowRun(
        tenant,
        workspace,
        steps,
        flow.name,
        flow.model,
        tags,
        // Who asked. Only a person: a key names an account, not a who, and a
        // gate that refused a key on self-approval grounds would be refusing
        // the whole account.
        actor.kind === "user" ? actor.name : null,
        { test },
      );
    } catch (err) {
      // The claim was taken before the run existed, so two retries could not
      // both win. A start that then failed — over budget, out of funds — must
      // hand it back, or every retry for a day is told "duplicate" with no
      // run behind it.
      if (idempotencyKey) await releaseRequestKey(tenant, workspace, `run:${flow.name}`, idempotencyKey);
      throw err;
    }
    if (idempotencyKey) await noteRequestRun(tenant, workspace, `run:${flow.name}`, idempotencyKey, run.id);
    // ?wait=true turns this into a request/response call — see server/wait.ts.
    if (wantsWait(req)) return waitAndRespond(req, tenant, workspace, run);
    return NextResponse.json({ ok: true, runId: run.id, steps: run.steps.length, test: run.test === true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
