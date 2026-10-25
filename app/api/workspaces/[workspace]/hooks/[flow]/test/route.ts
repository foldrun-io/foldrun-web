// Run one hook once, on a sample event, and report its answer.
//
// The segment is named [flow] because Next.js allows one dynamic segment name
// per level, and hooks/[flow]/ already holds a flow's WEBHOOK (GET its URL,
// POST rotate). Here the param is a HOOK's name — hooks/<name>/hook.md in the
// workspace, else library/hooks/<name>/ — the same nearest-wins rule a run
// resolves with, so what is tested is what a step would run.
//
// A hook is customer code. On an install that isolates runs it only ever
// runs inside a step's sandbox, so this refuses there (server/hooks.ts,
// hookTestRefusal) rather than spawn it in the web process; it spawns only on
// a laptop, where every step already runs in-process.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, ApiError } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { workspaceDir } from "@/lib/store";
import { libraryDir } from "@/lib/library";
import { resolveHooks, runHook } from "@/lib/hooks";
import { hookTestRefusal, testEvent } from "@/server/hooks";

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string; flow: string }> }) {
  try {
    const tenant = (await requirePermission(req, "run:start")).tenant;
    const { workspace, flow: name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { event?: unknown };
    if (body.event !== undefined && (!body.event || typeof body.event !== "object" || Array.isArray(body.event))) {
      throw new ApiError("event is one JSON object — the event the hook reads on stdin", 400);
    }

    const root = workspaceDir(tenant, workspace);
    const r = resolveHooks({ workspaceRoot: root, libraryRoot: libraryDir(tenant), names: [name] });
    if (r.missing.length) throw new ApiError(`no hook "${name}" in this workspace's hooks/ or the account library`, 404);
    if (r.errors.length) throw new ApiError(r.errors[0], 422);
    const def = r.hooks[0];

    const refusal = hookTestRefusal();
    // `failure` too, so a caller that prints an answer (the CLI) says why.
    if (refusal) return NextResponse.json({ ...refusal, hook: def.name, on: def.on, scope: def.scope, failure: refusal.summary });

    const event = testEvent(def, workspace, body.event as Record<string, unknown> | undefined);
    // runHook strips the environment to PATH/HOME/locale before the child
    // sees it — no platform secret, no model key — and kills it at its timeout.
    const answer = await runHook(def, event, { cwd: root, env: process.env });
    // The hook's own answer at the top level (ok, decision, reason, input,
    // context, reply, note, failure, ms), with which hook and what it read.
    return NextResponse.json({ ...answer, hook: def.name, on: def.on, scope: def.scope, event });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
