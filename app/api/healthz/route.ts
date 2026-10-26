// The probe. Unauthenticated by design — a load balancer holds no session —
// and says nothing an outsider can use: ok, the git sha, this process's role,
// and whether a worker is alive anywhere on this data directory. Depth and
// ages live in /api/metrics, which says more and therefore asks for a key.

import { NextResponse } from "next/server";
import { peekWorkerLease } from "@/platform/queue";
import { databaseEnabled, databaseReady } from "@/platform/db";
import { cacheEnabled, cacheReady } from "@/platform/cache";
import { versionInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function GET() {
  // Reported, never gated: healthz saying the database is down is how an
  // admin finds out, but refusing the probe would take the web tier out of
  // the load balancer for a dependency it can still serve most pages without.
  const [database, redis] = await Promise.all([
    databaseEnabled() ? databaseReady() : Promise.resolve(null),
    cacheEnabled() ? cacheReady() : Promise.resolve(null),
  ]);
  return NextResponse.json({
    ok: true,
    // The same answer as /api/version: the rollout's FOLDRUN_VERSION, else the
    // version baked into the image (release.json). Staging sets no
    // FOLDRUN_VERSION and said "dev" here while running v2026.10.25.21.
    version: versionInfo().version,
    role: process.env.FOLDRUN_ROLE ?? "all",
    // Read-only peek: a probe must never TAKE the lease from the worker.
    //
    // `workerAlive`, not `worker`: this asks whether a live worker holds the
    // lease on this data directory, NOT whether the answering process is it.
    // Before the role split those were the same question, because there was
    // one process. They are not any more — a web replica correctly reports
    // true here — and `worker: true` on a pod whose role is `web` reads as
    // exactly the double-driving this split exists to prevent.
    workerAlive: await peekWorkerLease(),
    database,
    redis,
  });
}
