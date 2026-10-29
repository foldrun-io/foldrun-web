// Next.js runs this once per server process. The boot sequence itself lives
// in the platform (foldrun-platform/src/boot.ts) so the worker can run it
// from its own entrypoint without a Next.js server around it; this hook is
// the web's call into it, plus the two one-time imports of files the web
// layer owns (users.json, keys.json).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Before anything boots: never serve with the auth bypass on where it would
  // be a cross-tenant hole (production, or a non-loopback public URL).
  const { devAuthStartupError } = await import("@/server/dev-auth-guard.ts");
  const devAuthError = devAuthStartupError(process.env);
  if (devAuthError) {
    console.error(`[foldrun] ${devAuthError}`);
    process.exit(1);
  }

  // An operator console (hosted only; the public server/surface.ts says
  // there is none) runs none of the app's boot: it holds no app database,
  // install key or data volume. Asked before the platform is imported, which
  // plugs itself in on import.
  const { consoleProcess, startSurfaceServices } = await import("@/server/surface.ts");
  if (consoleProcess()) return;

  const { prepare, startLoops, roleOf } = await import("@/platform/boot.ts");
  const { databaseEnabled } = await import("@/platform/db.ts");

  // Plug in, migrate, account keys, the platform's file imports.
  await prepare();

  if (databaseEnabled()) {
    // People first: the file's users into rows, once. Rows already there are
    // left alone — the database is authoritative from the moment it has
    // them, and a re-import must never revert a password changed since.
    try {
      const { importUsersFromFile } = await import("@/server/users.ts");
      const n = await importUsersFromFile();
      if (n) console.log(`[db] imported ${n} users from users.json`);
    } catch (err) {
      console.error("[db] users import failed:", err);
    }
    // API keys: keys.json into rows, once, then renamed aside (hashes only;
    // it is what a rollback to files would read). A key already in the table
    // is never overwritten, so a re-import cannot un-revoke one.
    try {
      const { importApiKeys } = await import("@/server/auth.ts");
      const n = await importApiKeys();
      if (n) console.log(`[db] imported ${n} API keys from keys.json`);
    } catch (err) {
      console.error("[db] API key import failed:", err);
    }
  }

  // A week's notice before an API key expires (server/key-expiry.ts). Every
  // role, hourly, under the housekeeping lease; each key is mailed once.
  if (process.env.FOLDRUN_DISABLE_SCHEDULER !== "1") {
    const { withHousekeeping } = await import("@/platform/housekeeping.ts");
    const { warnExpiringKeys } = await import("@/server/key-expiry.ts");
    const tick = () => void withHousekeeping("key-expiry", () => warnExpiringKeys()).catch((err) => console.error("[keys] expiry notices failed:", err));
    setTimeout(tick, 60_000).unref();
    setInterval(tick, 3_600_000).unref();
    // Warnings to accounts still calling a deprecated API route, and the
    // usage rows past keeping (server/api-deprecations.ts). Hourly, same lease.
    const { warnDeprecatedCallers } = await import("@/server/api-deprecations.ts");
    const deprecations = () => void withHousekeeping("api-deprecations", () => warnDeprecatedCallers()).catch((err) => console.error("[api] deprecation warnings failed:", err));
    setTimeout(deprecations, 90_000).unref();
    setInterval(deprecations, 3_600_000).unref();
  }

  // What the hosted app runs beside itself (its internal admin API, for the
  // operator console); nothing in the public edition.
  await startSurfaceServices();

  // `web` serves and runs nothing. `worker` should not be a Next.js server
  // at all any more (foldrun-platform/src/worker.ts), but a worker started
  // from this image still works: the loops are the same. `all` is the
  // single-process shape, the laptop.
  if (roleOf() === "web") return;
  // The assistant reads the live foldrun-docs checkout when one is beside
  // this app; registered before the loops, which run replies in `all`.
  await import("@/server/assistant-docs");
  await startLoops();
}
