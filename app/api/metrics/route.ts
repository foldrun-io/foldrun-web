// Operational numbers, Prometheus text format — the evidence that says when
// the single-host queue has actually hit its ceiling, instead of a guess.
// Authenticated: queue depth and per-tenant counts are operational intel.
//
// One way in: the scraper's bearer token, FOLDRUN_METRICS_TOKEN. A scraper is
// a process on a timer with no login, and no session or account key is
// accepted — the numbers are every account's, not one account's.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ApiError } from "@/server/api";
import { CLAIM_RENEW_MS, queueStats } from "@/platform/queue";
import { roomMetricsText } from "@/platform/room-metrics";
import { billingMetricsText } from "@/platform/billing-metrics";
import { listTenants, listWorkspaces, listRunSummaries } from "@/lib/store";
import { clientIp, refuseWhenLimited, sameToken, BAD_CALLBACK_TOKENS } from "@/server/limits";

export const dynamic = "force-dynamic";

/**
 * The scrape credential, compared in constant time (server/limits.ts
 * sameToken: byte lengths, so a non-ASCII guess is a plain no). Unset means
 * the token path is closed entirely — a scraper cannot get in by presenting
 * an empty string, which is what a plain equality check against an unset
 * variable would have allowed.
 */
function scraperAuthorized(req: NextRequest): boolean {
  const expected = process.env.FOLDRUN_METRICS_TOKEN;
  if (!expected) return false;
  const offered = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return sameToken(offered, expected);
}

/**
 * Wrong scrape tokens are counted (30 Oct 2026), as the open callbacks count
 * theirs: the API gate's limits key on an API key or a session, and this
 * token is neither, so a stranger could try tokens without end. Per caller
 * where a trusted proxy names one; else one count for the install — safe,
 * because only refusals are counted and the right token is compared first,
 * so a guesser can never throttle the real scraper.
 */
async function refuseWrongToken(req: NextRequest): Promise<NextResponse | null> {
  if (!process.env.FOLDRUN_METRICS_TOKEN) return null; // closed: nothing to guess
  return refuseWhenLimited(`metrics-refused:${clientIp(req) ?? "unknown"}`, BAD_CALLBACK_TOKENS.limit, BAD_CALLBACK_TOKENS.windowSec);
}

export async function GET(req: NextRequest) {
  try {
    // The scraper's token, and nothing else. The numbers are account-blind
    // — queue depth, every account's spend — so an account's key or session
    // must not read them; until 2026-09-25 any tenant could. Without a
    // token configured the route is closed, as scraperAuthorized says.
    if (!scraperAuthorized(req)) {
      const limited = await refuseWrongToken(req);
      if (limited) return limited;
      throw new ApiError("not found", 404);
    }
    const q = await queueStats();
    let running = 0;
    let awaiting = 0;
    for (const tenant of listTenants()) {
      for (const ws of listWorkspaces(tenant)) {
        for (const r of listRunSummaries(tenant, ws.name)) {
          if (r.status === "running") running += 1;
          else if (r.status === "awaiting-approval") awaiting += 1;
        }
      }
    }
    const lines = [
      "# HELP foldrun_queue_pending Jobs ready for a worker slot.",
      "# TYPE foldrun_queue_pending gauge",
      `foldrun_queue_pending ${q.pending}`,
      "# HELP foldrun_queue_scheduled Jobs held by their own wait: deadline.",
      "# TYPE foldrun_queue_scheduled gauge",
      `foldrun_queue_scheduled ${q.scheduledAhead}`,
      "# HELP foldrun_queue_claimed Jobs a driver is (or died) on.",
      "# TYPE foldrun_queue_claimed gauge",
      `foldrun_queue_claimed ${q.claimed}`,
      "# HELP foldrun_queue_oldest_pending_seconds Age of the longest-waiting ready job.",
      "# TYPE foldrun_queue_oldest_pending_seconds gauge",
      `foldrun_queue_oldest_pending_seconds ${q.oldestPendingSecs ?? 0}`,
      // Is a claimed job still being driven? (27 Oct 2026) Its worker renews
      // the claim every interval below, so a claim unrenewed for two is
      // stuck. Replaces "the claimed count has not changed", which a busy,
      // healthy queue at constant concurrency also satisfies.
      "# HELP foldrun_queue_oldest_claim_renewal_seconds Seconds since the least recently renewed claim was renewed (0 with no claim, and on the file queue, whose claims are not renewed).",
      "# TYPE foldrun_queue_oldest_claim_renewal_seconds gauge",
      `foldrun_queue_oldest_claim_renewal_seconds ${q.oldestClaimSecs ?? 0}`,
      "# HELP foldrun_queue_claim_renewal_interval_seconds How often a driving worker renews its claim.",
      "# TYPE foldrun_queue_claim_renewal_interval_seconds gauge",
      `foldrun_queue_claim_renewal_interval_seconds ${Math.round(CLAIM_RENEW_MS / 1000)}`,
      "# HELP foldrun_runs_running Runs executing now.",
      "# TYPE foldrun_runs_running gauge",
      `foldrun_runs_running ${running}`,
      "# HELP foldrun_runs_awaiting_approval Runs parked on a human.",
      "# TYPE foldrun_runs_awaiting_approval gauge",
      `foldrun_runs_awaiting_approval ${awaiting}`,
      ...(await billingMetricsText()),
      // Steps waiting for room (27 Oct 2026): parked ones count as
      // "scheduled" above, and waits in a driver did not count at all.
      ...roomMetricsText(),
    ];
    return new NextResponse(lines.join("\n") + "\n", {
      headers: { "content-type": "text/plain; version=0.0.4" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
