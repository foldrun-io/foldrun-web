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
//   POST { action: "delete", until: "2026-08-01T00:00:00Z" }
//
// Delete (FOL-124) is the customer's own way to erase run content sooner
// than the retention window: finished runs only, an admin's
// (workspace:manage, dry runs too — a preview lists what exists), each
// run's status read again right before it goes. More than a call's share
// is not refused: the call deletes its share and says how many still
// match (`remaining`), and the caller asks again.
//
// Nothing is implicit: a request naming no filter at all is refused rather
// than treated as "everything".

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, reportError, requirePermission, refuse } from "@/server/api";
import { rerunFrom, stopRun } from "@/platform/queue";
import { deleteRun, listRunSummaries, readRun, runDisplayStatus } from "@/lib/store";
import { idempotent } from "@/server/idempotency";

/** The most runs one call will touch. A bulk action is a recovery tool, not
 *  a migration: past this, the answer is almost certainly a wrong filter,
 *  and finding that out after two hundred reruns have been billed is the
 *  expensive way to learn it. */
const MAX = 100;

interface BulkBody {
  action?: "stop" | "rerun" | "delete";
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
    const body = (await req.json().catch(() => ({}))) as BulkBody;
    // Erasing what happened is not running things: deleting is an admin's,
    // as one run's DELETE is (workspace:manage, 30 Oct 2026).
    const { tenant, actor } = await requirePermission(req, body.action === "delete" ? "workspace:manage" : "run:start");

    if (body.action !== "stop" && body.action !== "rerun" && body.action !== "delete") {
      return refuse('expected { action: "stop" | "rerun" | "delete" }', 400);
    }
    if (body.action === "delete" && body.from !== undefined) return refuse("from is rerun's; a delete takes the whole run", 400);
    if (body.from !== undefined && !(Number.isInteger(body.from) && body.from >= 1)) {
      return refuse("from is a step's number in the trace, a whole number from 1", 400);
    }
    const hasFilter =
      (body.runIds?.length ?? 0) > 0 || (body.status?.length ?? 0) > 0 || !!body.flow || !!body.since || !!body.until;
    if (!hasFilter) {
      return refuse("name what to act on: runIds, status, flow, since or until — a bulk action never defaults to everything", 400);
    }

    // An unparseable date must refuse, not disappear. A clause that silently
    // dropped out of the filter turned `since: "yesterday"` into "everything
    // in the workspace", which is the one thing this route promises never
    // to mean.
    for (const field of ["since", "until"] as const) {
      const raw = body[field];
      if (raw !== undefined && Number.isNaN(new Date(raw).getTime())) {
        return refuse(`${field} is not a date: ${JSON.stringify(raw)} — use an ISO instant`, 400);
      }
    }
    const matched = select(tenant, workspace, body);
    if (body.action === "delete") return deleteMatched(tenant, workspace, matched, body.dryRun === true);
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

/** Delete (FOL-124): the first MAX of the finished runs matched, each read
 *  again first — one that is live after all is skipped, never stopped. */
function deleteMatched(tenant: string, workspace: string, matched: { id: string; status?: string }[], dryRun: boolean) {
  const finished = matched.filter((r) => r.status === undefined || r.status === "completed" || r.status === "failed");
  const share = finished.slice(0, MAX);
  const remaining = finished.length - share.length;
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, action: "delete", matched: share.map((r) => r.id), remaining });
  const done: { runId: string; ok: boolean; error?: string }[] = [];
  for (const r of share) {
    try {
      const run = readRun(tenant, workspace, r.id);
      if (!run) {
        done.push({ runId: r.id, ok: false, error: "run not found" });
        continue;
      }
      if (run.status !== "completed" && run.status !== "failed") {
        done.push({ runId: r.id, ok: false, error: `${run.status} — only a finished run is deleted here; stop it first` });
        continue;
      }
      deleteRun(tenant, workspace, r.id);
      done.push({ runId: r.id, ok: true });
    } catch (err) {
      done.push({ runId: r.id, ok: false, error: reportError(err).message });
    }
  }
  return NextResponse.json({
    ok: true,
    action: "delete",
    matched: share.length,
    succeeded: done.filter((d) => d.ok).length,
    failed: done.filter((d) => !d.ok).length,
    remaining,
    runs: done,
  });
}

/** The runs a filter names, newest first. Every clause is an AND, and an
 *  absent clause constrains nothing. Read off the runs index, as the list
 *  route is (30 Oct 2026): listRuns JSON-parsed every record in the
 *  workspace on every call, dry runs included, and only id, flow, status and
 *  startedAt are needed here. */
function select(tenant: string, workspace: string, body: BulkBody): { id: string; status?: string }[] {
  const ids = body.runIds?.length ? new Set(body.runIds) : null;
  const statuses = body.status?.length ? new Set(body.status) : null;
  const since = body.since ? new Date(body.since).getTime() : null;
  const until = body.until ? new Date(body.until).getTime() : null;
  const found = listRunSummaries(tenant, workspace)
    .filter((r) => {
      if (ids && !ids.has(r.id)) return false;
      // "stopped" is the status the runs list shows a run a person stopped;
      // its record says "failed" (runDisplayStatus). Either name matches it,
      // so `--status stopped` finds it and `--status failed` still does.
      if (statuses && !statuses.has(r.status) && !statuses.has(runDisplayStatus(r))) return false;
      if (body.flow && r.flow !== body.flow) return false;
      const at = new Date(r.startedAt).getTime();
      if (since !== null && Number.isFinite(since) && at < since) return false;
      if (until !== null && Number.isFinite(until) && at > until) return false;
      return true;
    })
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  // A run named by id is never dropped silently: one the index cannot
  // summarise (a torn record) or does not hold is still tried, so the answer
  // says what went wrong with it. Only when the ids are the whole filter — a
  // status or date clause cannot be judged without the summary.
  if (ids && !statuses && !body.flow && since === null && until === null) {
    const have = new Set(found.map((r) => r.id));
    const picked: { id: string; status?: string }[] = [...found];
    for (const id of ids) if (!have.has(id)) picked.push({ id });
    return picked;
  }
  return found;
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
