// What /api/healthz reports about its dependencies, looked at once per few
// seconds per process rather than once per call.

import { peekWorkerLease } from "@/platform/queue";
import { databaseEnabled, databaseReady } from "@/platform/db";
import { cacheEnabled, cacheReady } from "@/platform/cache";

export interface HealthDependencies {
  database: boolean | null;
  redis: boolean | null;
  workerAlive: boolean;
}

/** How long one look at the database, Redis and the lease answers every
 *  probe. The route is open and unmetered, so each call ran a SELECT 1, a
 *  PING and a lease read: a flood held pool connections. Probes come every
 *  few seconds; a few seconds' staleness costs them nothing (30 Oct 2026). */
const DEPS_TTL_MS = 5_000;
let deps: { at: number; value: Promise<HealthDependencies> } | null = null;

export function healthDependencies(): Promise<HealthDependencies> {
  if (deps && Date.now() - deps.at < DEPS_TTL_MS) return deps.value;
  const value = (async () => {
    const [database, redis, workerAlive] = await Promise.all([
      databaseEnabled() ? databaseReady() : Promise.resolve(null),
      cacheEnabled() ? cacheReady() : Promise.resolve(null),
      // Read-only peek: a probe must never TAKE the lease from the worker.
      peekWorkerLease(),
    ]);
    return { database, redis, workerAlive };
  })();
  // A look that threw is not kept: the next probe tries again.
  value.catch(() => {
    if (deps?.value === value) deps = null;
  });
  deps = { at: Date.now(), value };
  return value;
}

/** Forget the last look — for tests. */
export function resetHealthDependencies(): void {
  deps = null;
}
