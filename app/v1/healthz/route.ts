// The probe. Unauthenticated by design — a load balancer holds no session —
// and so it says only `ok`. The release, this process's role and whether the
// database, Redis and a worker answer go to a caller with a key, a session or
// the scraper's token (server/probe-access.ts). Depth and ages live in
// /v1/metrics, which says more and therefore asks for the scraper's token.

import { NextRequest, NextResponse } from "next/server";
import { healthDependencies } from "@/server/healthz";
import { mayReadProbeDetail } from "@/server/probe-access";
import { versionInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Reported, never gated: healthz saying the database is down is how an
  // admin finds out, but refusing the probe would take the web tier out of
  // the load balancer for a dependency it can still serve most pages without.
  // The status stays 200 for everyone, so a probe, a load balancer and the
  // uptime check (which look for `"ok":true`) work as before.
  if (!(await mayReadProbeDetail(req))) return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const { database, redis, workerAlive } = await healthDependencies();
  return NextResponse.json({
    ok: true,
    // The same answer as /v1/version: the rollout's FOLDRUN_VERSION, else the
    // version baked into the image (release.json). Staging sets no
    // FOLDRUN_VERSION and said "dev" here while running v2026.10.25.21.
    version: versionInfo().version,
    role: process.env.FOLDRUN_ROLE ?? "all",
    // `workerAlive`, not `worker`: this asks whether a live worker holds the
    // lease on this data directory, NOT whether the answering process is it.
    // Before the role split those were the same question, because there was
    // one process. They are not any more — a web replica correctly reports
    // true here — and `worker: true` on a pod whose role is `web` reads as
    // exactly the double-driving this split exists to prevent.
    workerAlive,
    database,
    redis,
  });
}
