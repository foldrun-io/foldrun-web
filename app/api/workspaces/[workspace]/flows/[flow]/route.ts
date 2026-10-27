// PATCH a flow's arrangement — what the drag-and-drop board on the flows page
// posts. The body is the new grouping, as indices into the flow's parsed
// steps: [[0], [1, 2], [3]] means "step 0, then 1 and 2 in parallel, then 3".
//
// Nothing but the step numbers changes on disk, so a rearrangement is a clean
// one-line-per-step diff in git.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { errorResponse, requirePermission, actorOf } from "@/server/api";
import { parseCron } from "@/platform/scheduler";
import {
  workspaceDir,
  parseFlow,
  reorderFlowSteps,
  addFlowStep,
  setFlowTrigger,
  updateFlowStep,
  updateFlowStepInstruction,
  assertSafeName,
  writeWorkspaceFile,
} from "@/lib/store";
import { applyPatternEdit, removeStep, type PatternEdit } from "@/lib/flow-patterns";
import { idempotent } from "@/server/idempotency";
import { configMatter } from "@/lib/matter";
import { patchFrontmatter } from "@/lib/agents-md";
import { computePatch } from "@/components/defaults-model";

/** Write a flow file the way /source does: through writeWorkspaceFile, so
 *  the change is on the workspace's revision log with who made it. A
 *  flow-board edit used to be a bare fs write that history never saw. */
async function saveFlow(req: NextRequest, tenant: string, workspace: string, file: string, content: string, message: string) {
  const rel = path.relative(workspaceDir(tenant, workspace), file).split(path.sep).join("/");
  writeWorkspaceFile(tenant, workspace, rel, content, { by: await actorOf(req), message });
}

function flowFile(tenant: string, workspace: string, flow: string) {
  assertSafeName(flow, "flow");
  const dir = path.join(workspaceDir(tenant, workspace), "flows");
  if (!fs.existsSync(dir)) return null;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const full = path.join(dir, file);
    if (file === `${flow}.md` || parseFlow(file, fs.readFileSync(full, "utf8")).name === flow) {
      return full;
    }
  }
  return null;
}

// Add a step to the end of a flow: { target, subflow?, instruction? }.

/** Whether the file reads `expect`: the text itself, or its sha256 (what
 *  GET …/source answers, and what the CLI sends). */
const readsAs = (text: string, expect: string) =>
  text === expect || createHash("sha256").update(text, "utf8").digest("hex") === expect;
async function postOnce(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; flow: string }> },
) {
  try {
    const { workspace, flow } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as {
      target?: string;
      subflow?: boolean;
      instruction?: string;
    };
    if (!body.target) return NextResponse.json({ error: "expected { target }" }, { status: 400 });

    const file = flowFile(tenant, workspace, flow);
    if (!file) return NextResponse.json({ error: "flow not found" }, { status: 404 });

    const rewritten = addFlowStep(fs.readFileSync(file, "utf8"), {
      target: body.target,
      subflow: body.subflow,
      instruction: body.instruction,
    });
    await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
    return NextResponse.json({ ok: true, flow: parseFlow(path.basename(file), rewritten) });
  } catch (err) {
    return errorResponse(err);
  }
}

// Remove one step by its index in the flow's parsed steps — core's removeStep,
// the same edit as PATCH { edit: { op: "remove" } }: the step line and its
// options go, prose after it stays, groups renumber.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; flow: string }> },
) {
  try {
    const { workspace, flow } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as { step?: number; expect?: string };
    if (typeof body.step !== "number") {
      return NextResponse.json({ error: "expected { step, expect? }" }, { status: 400 });
    }

    const file = flowFile(tenant, workspace, flow);
    if (!file) return NextResponse.json({ error: "flow not found" }, { status: 404 });

    const before = fs.readFileSync(file, "utf8");
    if (typeof body.expect === "string" && !readsAs(before, body.expect)) {
      return NextResponse.json({ error: `${flow} changed since it was loaded — reload to see the change, then try again`, text: before }, { status: 409 });
    }
    const rewritten = removeStep(before, body.step);
    await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
    return NextResponse.json({ ok: true, flow: parseFlow(path.basename(file), rewritten) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH shapes: { groups } rearranges steps (the board), { trigger }
// rewrites how the flow starts (the trigger picker), { step, options }
// rewrites one step's options (the step editor), { edit } is one canvas
// gesture — a pattern block dropped (core flow-patterns.ts), { edits } is
// several applied in order as ONE write (delete a selection), and
// { restore, expect } puts back a whole earlier text (the canvas's undo) —
// only while the file still reads `expect`, so an undo never steps over
// someone else's edit. One verb because all of them are "change this
// flow's shape". Every write answers with `before` and `text`, the file
// either side of it: what the canvas's undo keeps. Every shape takes
// `expect` (the text, or its sha256) and is refused with 409 when the file
// no longer reads it — the canvas and the CLI send it.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; flow: string }> },
) {
  try {
    const { workspace, flow } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json().catch(() => ({}))) as {
      groups?: number[][];
      trigger?: { trigger?: string; schedule?: string; timezone?: string };
      step?: number;
      options?: Record<string, string | number | null>;
      instruction?: string;
      edit?: PatternEdit;
      edits?: PatternEdit[];
      restore?: string;
      expect?: string;
      compute?: Record<string, unknown> | null;
    };

    const file = flowFile(tenant, workspace, flow);
    if (!file) return NextResponse.json({ error: "flow not found" }, { status: 404 });
    const before = fs.readFileSync(file, "utf8");
    const wrote = (text: string) =>
      NextResponse.json({ ok: true, flow: parseFlow(path.basename(file), text), before, text });
    // `expect` on any shape: the text the caller's step indices were read
    // from, or its sha256. A stale canvas, or a CLI that waited at y/N while
    // someone else edited, would otherwise hit whichever step has that index
    // now; refused with 409 and the current text instead.
    if (typeof body.expect === "string" && !readsAs(before, body.expect)) {
      return NextResponse.json({ error: `${flow} changed since it was loaded — reload to see the change, then try again`, text: before }, { status: 409 });
    }

    if (typeof body.restore === "string") {
      if (typeof body.expect !== "string") return NextResponse.json({ error: "restore needs { expect } — the text you last saw" }, { status: 400 });
      await saveFlow(req, tenant, workspace, file, body.restore, "flow edit undone on the canvas");
      return wrote(body.restore);
    }

    if (Array.isArray(body.edits) && body.edits.length) {
      let rewritten = before;
      for (const e of body.edits) rewritten = applyPatternEdit(rewritten, e);
      await saveFlow(req, tenant, workspace, file, rewritten, "flow edited on the canvas");
      return wrote(rewritten);
    }

    if (body.edit && typeof body.edit === "object") {
      const rewritten = applyPatternEdit(before, body.edit);
      await saveFlow(req, tenant, workspace, file, rewritten, "flow edited on the canvas");
      return wrote(rewritten);
    }

    // { compute } — the run's pool (27 Oct 2026): what one run's steps may
    // hold together, merged over what the flow says (computePatch), so a
    // client that sends only vcpu keeps memory and disk.
    if ("compute" in body) {
      let current: unknown;
      try {
        current = (configMatter(before).data ?? {}).compute;
      } catch {
        current = undefined;
      }
      const c = computePatch(body.compute, current);
      if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
      const rewritten = patchFrontmatter(before, { compute: c.value });
      await saveFlow(req, tenant, workspace, file, rewritten, "flow compute: set");
      return wrote(rewritten);
    }

    if (body.trigger) {
      // The scheduler's parser is the authority on what will actually fire.
      if (body.trigger.trigger === "schedule" && !parseCron((body.trigger.schedule ?? "").trim())) {
        return NextResponse.json(
          { error: `"${body.trigger.schedule ?? ""}" is not a cron expression the scheduler can fire` },
          { status: 400 },
        );
      }
      const rewritten = setFlowTrigger(before, {
        trigger: (body.trigger.trigger ?? "manual") as "manual" | "schedule" | "webhook",
        schedule: body.trigger.schedule,
        timezone: body.trigger.timezone,
      });
      await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
      return wrote(rewritten);
    }

    // { step, instruction } — flow-local text, so it edits the flow file and
    // nothing the agent owns.
    if (typeof body.step === "number" && typeof body.instruction === "string") {
      const rewritten = updateFlowStepInstruction(
        before,
        body.step,
        body.instruction,
      );
      await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
      return wrote(rewritten);
    }
    if (typeof body.step === "number" && body.options) {
      const rewritten = updateFlowStep(before, body.step, body.options);
      await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
      return wrote(rewritten);
    }

    if (!Array.isArray(body.groups) || body.groups.some((g) => !Array.isArray(g))) {
      return NextResponse.json({ error: "expected { groups }, { trigger }, { step, options }, { step, instruction }, { edit }, { edits } or { restore, expect }" }, { status: 400 });
    }

    const rewritten = reorderFlowSteps(before, body.groups);
    await saveFlow(req, tenant, workspace, file, rewritten, "flow edited from the dashboard");
    return wrote(rewritten);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
