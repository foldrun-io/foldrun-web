// Server-sent events for one run.
//
// The run record is an append-only JSON file the runner rewrites after every
// event, so streaming is just: watch the file, push when it changes. Reading
// it is a local disk hit (sub-millisecond), which is why a 250ms watch here
// costs far less than the 2.5s full-page refresh it replaces — and arrives
// ~10x sooner.

import { NextRequest } from "next/server";
import fs from "node:fs";
import { requireTenant, errorStatus } from "@/server/api";
import { runFilePath } from "@/lib/store";
import { isRunTerminal, sseFrame } from "@/components/live-run-model";

export const dynamic = "force-dynamic";

const POLL_MS = 250;
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
  try {
    tenant = await requireTenant(req);
  } catch (err) {
    // 401 for no credential, 403 for a scope that does not include this
    // workspace — the same answer the JSON routes give, not one for both.
    const { status, message } = errorStatus(err);
    return new Response(message, { status });
  }

  const file = runFilePath(tenant, workspace, runId);
  if (!fs.existsSync(file)) return new Response("run not found", { status: 404 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let lastPayload = "";
      const started = Date.now();

      // Everything stops together. A client that went away without an
      // abort — a closed laptop, a proxy that dropped the socket — shows
      // up as enqueue throwing on a closed controller, and that used to be
      // swallowed by the catch below, so the 250 ms timer kept reading the
      // file for a dead socket until the 30-minute cap.
      let stopped = false;
      const stop = () => {
        stopped = true;
        clearInterval(timer);
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          stop();
          throw new StreamGone();
        }
      };

      const tick = () => {
        try {
          const raw = fs.readFileSync(file, "utf8");
          if (raw !== lastPayload) {
            lastPayload = raw;
            send("run", raw);
            const run = JSON.parse(raw);
            // Only a run that is over ends the stream — the client stops
            // listening rather than reconnecting forever. Everything else
            // stays open: a queued run so the page sees the worker pick it
            // up, and a run parked at a gate so it sees the approval land.
            // This used to end at the gate too, and the page then had no
            // way to learn the run had resumed: approving a step left the
            // panel frozen on "waiting" until someone reloaded it.
            if (isRunTerminal(run.status)) {
              send("done", JSON.stringify({ status: run.status }));
              stop();
              return;
            }
          }
          // Past the cap the socket closes without a `done`: the browser's
          // EventSource reconnects on its own and picks up where it was.
          if (Date.now() - started > MAX_MS) stop();
        } catch (err) {
          if (err instanceof StreamGone) return;
          // A partially-written file just means "try again next tick".
        }
      };

      tick(); // send current state immediately, no first-paint delay
      // A run already over, or a client already gone, ends before the
      // timers exist — the first tick used to close the controller and
      // the intervals were then started against it anyway.
      if (stopped) return;
      timer = setInterval(tick, POLL_MS);
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
      clearInterval(timer);
      clearInterval(beat);
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
