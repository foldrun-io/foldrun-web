// Server-sent events for one run.
//
// The run record is an append-only JSON file the runner rewrites after every
// event, so streaming is just: watch the file, push when it changes. Reading
// it is a local disk hit (sub-millisecond), which is why a 250ms watch here
// costs far less than the 2.5s full-page refresh it replaces — and arrives
// ~10x sooner.

import { runMoney } from "@/server/run-charges";
import { cursorOf, parseCursor, deltaSince } from "@/server/run-delta";
import { NextRequest } from "next/server";
import { requireCaller, errorResponse, refuse } from "@/server/api";
import { runTextFor } from "@/server/run-links";
import { runFilePath, runStamp, readRunText } from "@/lib/store";
import { records } from "@/lib/records";
import { runNotifyLive, watchRun } from "@/platform/run-notify";
import { isRunTerminal, sseFrame } from "@/components/live-run-model";

export const dynamic = "force-dynamic";

const POLL_MS = 250;
/** How slow the watch gets while nothing changes (30 Oct 2026). Each idle
 *  tick doubles the wait up to this; a change drops it back to POLL_MS. */
const IDLE_MAX_MS = 2_000;
/** A full read at least this often even when the stat says nothing changed —
 *  a rewrite of the same size inside a coarse mtime (NFS) is not missed. */
const FORCE_READ_MS = 10_000;
/** While the run's record is in the database and this process is listening
 *  for its writes (run-notify.ts, 12 Nov 2026), a write wakes the stream at
 *  once and an idle stream only checks this often — the safety net for a
 *  missed notification. Each check was a blocking round trip to Postgres on
 *  the web process's event loop, two to eight times a second per viewer. */
const NOTIFIED_IDLE_MS = FORCE_READ_MS;
const MAX_MS = 30 * 60_000; // don't hold a socket open forever

// A step can think for minutes without writing anything, and this stream only
// speaks when the run file changes — so a healthy run looks exactly like a
// dead socket to anything counting idle seconds. Every proxy does: an ALB
// defaults to 60s, nginx to 60s, Cloudflare to 100s. The fix is the one the
// SSE spec provides for it: a comment line, which clients ignore and
// intermediaries count as traffic.
const HEARTBEAT_MS = 15_000;

/** Thrown by send() once the controller is closed, so a tick unwinds
 *  without treating a dead client as a half-written file. */
class StreamGone extends Error {}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; runId: string }> },
) {
  const { workspace, runId } = await ctx.params;
  let tenant: string;
  let actor: Awaited<ReturnType<typeof requireCaller>>["actor"];
  try {
    ({ tenant, actor } = await requireCaller(req));
  } catch (err) {
    // 401 for no credential, 403 for a scope that does not include this
    // workspace — the same answer the JSON routes give, not one for both.
    // A refusal is `{ error }` JSON here too, as on every other route and as
    // the OpenAPI document says (FOL-75, 5 Nov 2026): it was plain text, so
    // a client reading `error` from it got nothing. Only a 200 is a stream.
    return errorResponse(err);
  }

  // A name the store refuses (control characters, a path) cannot be a run:
  // 404, not the 500 an uncaught throw gave (27 Oct 2026, the API fuzz).
  try {
    runFilePath(tenant, workspace, runId);
  } catch {
    return refuse("run not found", 404);
  }
  // The record's stamp is its file's stat, or its row's last write when the
  // records are in the database.
  if (runStamp(tenant, workspace, runId) === null) return refuse("run not found", 404);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let unwatch: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let lastPayload = "";
      const started = Date.now();
      // Deltas (FOL-158): asked for with ?delta=1; a reconnect resumes from
      // the Last-Event-ID it sends (the cursor of the last event it had).
      const deltaMode = req.nextUrl.searchParams.get("delta") === "1";
      const resume = deltaMode ? parseCursor(req.headers.get("last-event-id")) : null;
      let lastCounts: number[] | null = null;
      let lastHeaders: string[] | undefined;

      // Everything stops together. A client that went away without an
      // abort — a closed laptop, a proxy that dropped the socket — shows
      // up as enqueue throwing on a closed controller, and that used to be
      // swallowed by the catch below, so the 250 ms timer kept reading the
      // file for a dead socket until the 30-minute cap.
      let stopped = false;
      const stop = () => {
        stopped = true;
        clearTimeout(timer);
        clearInterval(beat);
        unwatch?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (event: string, data: string, id?: string) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data, id)));
        } catch {
          stop();
          throw new StreamGone();
        }
      };

      // The file is read only when its stat moved (30 Oct 2026). Every open
      // stream re-read the whole run record every 250 ms for up to 30
      // minutes — MBs of events, four times a second, per viewer. A stat is
      // what tells us it changed; FORCE_READ_MS is the safety net.
      let lastStat = "";
      let lastRead = 0;
      // The run is over and `done` is on its way: nothing more is scheduled.
      let ending = false;
      let wait = POLL_MS;
      // Records in the database: writes announce themselves (run-notify.ts).
      const notified = records(tenant, workspace) !== null;
      const idleMax = () => (notified && runNotifyLive() ? NOTIFIED_IDLE_MS : IDLE_MAX_MS);
      const changed = (): boolean => {
        // Null: gone for a moment (a rename in flight): read to find out.
        const now = runStamp(tenant, workspace, runId) ?? "";
        const due = Date.now() - lastRead >= FORCE_READ_MS;
        if (now && now === lastStat && !due) return false;
        lastStat = now;
        lastRead = Date.now();
        return true;
      };

      const tick = () => {
        try {
          if (!changed()) {
            wait = Math.min(wait * 2, idleMax());
            if (Date.now() - started > MAX_MS) stop();
            return;
          }
          const stored = readRunText(tenant, workspace, runId);
          if (stored === null) throw new Error("the record is not there this tick");
          // What this caller may read of it: no release link for a viewer (run-links.ts).
          const raw = runTextFor(stored, actor);
          if (raw === lastPayload) wait = Math.min(wait * 2, idleMax());
          if (raw !== lastPayload) {
            wait = POLL_MS;
            lastPayload = raw;
            const run = JSON.parse(raw);
            // Every event carries the cursor (FOL-158). With ?delta=1, after
            // the first whole record (or from a Last-Event-ID), a `delta`
            // event carries only what changed; a cursor that does not fit is
            // answered with the whole record again.
            const base = lastCounts ?? resume;
            const d = deltaMode && base !== null ? deltaSince(run, base, lastHeaders) : null;
            if (d) {
              send("delta", JSON.stringify(d.delta), cursorOf(run));
              lastHeaders = d.headers;
            } else {
              send("run", raw, cursorOf(run));
              lastHeaders = deltaMode ? deltaSince(run, [])?.headers : undefined;
            }
            lastCounts = deltaMode ? run.steps.map((st: { events?: unknown[] }) => (st.events ?? []).length) : null;
            // Only a run that is over ends the stream — the client stops
            // listening rather than reconnecting forever. Everything else
            // stays open: a queued run so the page sees the worker pick it
            // up, and a run parked at a gate so it sees the approval land.
            // This used to end at the gate too, and the page then had no
            // way to learn the run had resumed: approving a step left the
            // panel frozen on "waiting" until someone reloaded it.
            if (isRunTerminal(run.status)) {
              // Its money with it (FOL-157): usually the estimate — the worker
              // settles the run a moment after it ends; GET …/runs/<id> has
              // the charge once it has.
              // Read off the event loop's tick: no further tick is scheduled
              // (ending), then `done` goes out with the money and the stream ends.
              ending = true;
              void runMoney(tenant, run)
                .catch(() => ({}))
                .then((money) => {
                  try {
                    send("done", JSON.stringify({ status: run.status, ...money }));
                  } catch {
                    /* the client left meanwhile */
                  }
                  stop();
                });
              return;
            }
          }
          // Past the cap the socket closes without a `done`: the browser's
          // EventSource reconnects on its own and picks up where it was.
          if (Date.now() - started > MAX_MS) stop();
        } catch (err) {
          if (err instanceof StreamGone) return;
          // A partially-written file just means "try again next tick" — and
          // the next tick must read it, whatever the stat says.
          lastStat = "";
        }
      };
      // One tick at a time, each scheduling the next at the current wait.
      let lastTick = 0;
      const loop = () => {
        lastTick = Date.now();
        tick();
        if (!stopped && !ending) timer = setTimeout(loop, wait);
      };

      tick(); // send current state immediately, no first-paint delay
      // A run already over, or a client already gone, ends before the
      // timers exist — the first tick used to close the controller and
      // the intervals were then started against it anyway.
      if (stopped || ending) return;
      timer = setTimeout(loop, wait);
      // A write to this run by any copy of the platform: look now, not at
      // the end of the current wait.
      if (notified) {
        unwatch = watchRun(tenant, workspace, runId, () => {
          if (stopped || ending) return;
          clearTimeout(timer);
          wait = POLL_MS;
          // A burst of writes is read at most once per POLL_MS, as before.
          timer = setTimeout(loop, Math.max(0, POLL_MS - (Date.now() - lastTick)));
        });
      }
      beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          stop();
        }
      }, HEARTBEAT_MS);

      if (req.signal.aborted) stop();
      req.signal.addEventListener("abort", stop);
    },
    cancel() {
      clearTimeout(timer);
      clearInterval(beat);
      unwatch?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // don't let a proxy buffer the stream
    },
  });
}
