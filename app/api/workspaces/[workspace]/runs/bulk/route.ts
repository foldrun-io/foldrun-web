// One decision, many runs.
//
// Every run action here already existed one run at a time, which is fine
// until the day something breaks for all of them at once. When the nightly
// prune deleted the runner image, every flow on the box failed within the
// hour, and putting them right meant opening seventy run pages and clicking
// the same button on each. The same is true of a stop: a bad deploy that
// starts forty runs is stopped forty times, by hand, while they spend.
//
// The filter is deliberately small and literal — statuses, a flow name, a
// time window, an explicit list of ids. No query language: this is a blunt
// instrument for a bad morning, and anything cleverer would need a parser
// and a page of documentation for a route whose whole point is to be
// reachable in a hurry.
//
//   POST { action: "stop",  status: ["running", "queued"] }
//   POST { action: "rerun", status: ["failed"], since: "2026-09-03T14:00:00Z" }
//   POST { action: "rerun", runIds: ["run-x", "run-y"], from: 2 }
//
// Nothing is implicit: a request naming no filter at all is refused rather
// than treated as "everything".

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, reportError, requirePermission } from "@/server/api";
import { rerunFrom, stopRun } from "@/platform/queue";
import { listRuns } from "@/lib/store";
import { idempotent } from "@/server/idempotency";

/** The most runs one call will touch. A bulk action is a recovery tool, not
 *  a migration: past this, the answer is almost certainly a wrong filter,
 *  and finding that out after two hundred reruns have been billed is the
 *  expensive way to learn it. */
const MAX = 100;

interface BulkBody {
  action?: "stop" | "rerun";
  status?: string[];
  flow?: string;
  /** ISO instant — only runs that started at or after it. */
  since?: string;
  /** ISO instant — only runs that started at or before it. */
  until?: string;
  runIds?: string[];
  /** rerun only: which step to start from, as the trace numbers them. */
  from?: number;
  /** Answer with what WOULD be touched, and touch nothing. */
  dryRun?: boolean;
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const body = (await req.json().catch(() => ({}))) as BulkBody;

    if (body.action !== "stop" && body.action !== "rerun") {
      return NextResponse.json({ error: 'expected { action: "stop" | "rerun" }' }, { status: 400 });
    }
    if (body.from !== undefined && !(Number.isInteger(body.from) && body.from >= 1)) {
      return NextResponse.json({ error: "from is a step's number in the trace, a whole number from 1" }, { status: 400 });
    }
    const hasFilter =
      (body.runIds?.length ?? 0) > 0 || (body.status?.length ?? 0) > 0 || !!body.flow || !!body.since || !!body.until;
    if (!hasFilter) {
      return NextResponse.json(
        { error: "name what to act on: runIds, status, flow, since or until — a bulk action never defaults to everything" },
        { status: 400 },
      );
    }

    // An unparseable date must refuse, not disappear. A clause that silently
    // dropped out of the filter turned `since: "yesterday"` into "everything
    // in the workspace", which is the one thing this route promises never
    // to mean.
    for (const field of ["since", "until"] as const) {
      const raw = body[field];
      if (raw !== undefined && Number.isNaN(new Date(raw).getTime())) {
        return NextResponse.json({ error: `${field} is not a date: ${JSON.stringify(raw)} — use an ISO instant` }, { status: 400 });
      }
    }
    const matched = select(tenant, workspace, body);
    if (matched.length > MAX) {
      return NextResponse.json(
        {
          error: `${matched.length} runs match, which is more than the ${MAX} one call will touch — narrow the filter (a tighter since/until is usually what is meant)`,
          matched: matched.length,
        },
        { status: 422 },
      );
    }
    if (body.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, matched: matched.map((r) => r.id) });
    }

    // Each run is its own outcome. One that cannot be stopped because it
    // finished a second ago must not abort the other thirty: a partial
    // result that says which is far more useful than an error that says
    // nothing was done.
    const done: { runId: string; ok: boolean; newRunId?: string; error?: string }[] = [];
    for (const run of matched) {
      try {
        if (body.action === "stop") {
          stopRun(tenant, workspace, run.id);
          done.push({ runId: run.id, ok: true });
        } else {
          const fresh = await rerunFrom(tenant, workspace, run.id, { step: body.from ?? 1 }, actor.kind === "user" ? actor.name : null);
          done.push({ runId: run.id, ok: true, newRunId: fresh.id });
        }
      } catch (err) {
        // The same scrub one run's error gets: a refusal's sentence, but a
        // TypeError or an fs fault (with its server path) is logged and
        // answered as "something went wrong on our side" (30 Oct 2026).
        done.push({ runId: run.id, ok: false, error: reportError(err).message });
      }
    }
    return NextResponse.json({
      ok: true,
      action: body.action,
      matched: matched.length,
      succeeded: done.filter((d) => d.ok).length,
      failed: done.filter((d) => !d.ok).length,
      runs: done,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The runs a filter names, newest first. Every clause is an AND, and an
 *  absent clause constrains nothing. */
function select(tenant: string, workspace: string, body: BulkBody) {
  const ids = body.runIds?.length ? new Set(body.runIds) : null;
  const statuses = body.status?.length ? new Set(body.status) : null;
  const since = body.since ? new Date(body.since).getTime() : null;
  const until = body.until ? new Date(body.until).getTime() : null;
  return listRuns(tenant, workspace)
    .filter((r) => {
      if (ids && !ids.has(r.id)) return false;
      if (statuses && !statuses.has(r.status)) return false;
      if (body.flow && r.flow !== body.flow) return false;
      const at = new Date(r.startedAt).getTime();
      if (since !== null && Number.isFinite(since) && at < since) return false;
      if (until !== null && Number.isFinite(until) && at > until) return false;
      return true;
    })
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
