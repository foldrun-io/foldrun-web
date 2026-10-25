// FOLDRUN_DEV_NO_AUTH turns the whole auth model off: resolveTenant then
// trusts the `x-foldrun-tenant` header as that account's owner (server/auth.ts)
// and proxy.ts skips the session check. That is exactly right on a laptop and
// a full cross-tenant read/write hole anywhere the internet can reach. This is
// the boot-time fence: refuse to start if the bypass is on somewhere it would
// be a hole, so a stray env var fails loudly at startup instead of silently
// serving every account to a header.

// Loopback only — the single place the bypass is defensible. `new URL(...)`
// gives IPv6 back bracketed, so both spellings are here.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * On only for the one value proxy.ts and resolveTenant act on. "0", "false",
 * "", unset — the bypass is off, and there is nothing to refuse.
 */
export function devAuthEnabled(env: Record<string, string | undefined>): boolean {
  return env.FOLDRUN_DEV_NO_AUTH === "1";
}

/**
 * A sentence to print before exiting, or null when the boot may proceed.
 *
 * Pure: it reads only the env object handed to it, so a test can refuse and
 * allow without a real process. The rule: with the bypass on, refuse under
 * NODE_ENV=production, or when FOLDRUN_PUBLIC_URL names a host that is not
 * loopback (a real origin the bypass would expose). No public URL and not
 * production is a plain laptop — allowed.
 */
export function devAuthStartupError(env: Record<string, string | undefined>): string | null {
  if (!devAuthEnabled(env)) return null;

  if (env.NODE_ENV === "production") {
    return "FOLDRUN_DEV_NO_AUTH=1 with NODE_ENV=production — refusing to start. The bypass trusts any x-foldrun-tenant header as that account's owner, a cross-tenant hole. Unset FOLDRUN_DEV_NO_AUTH.";
  }

  const raw = env.FOLDRUN_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (raw) {
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return `FOLDRUN_DEV_NO_AUTH=1 and FOLDRUN_PUBLIC_URL=${raw} does not parse — refusing to start. The bypass is only safe on localhost; unset one of them.`;
    }
    if (!LOCAL_HOSTS.has(host)) {
      return `FOLDRUN_DEV_NO_AUTH=1 while FOLDRUN_PUBLIC_URL points at ${host} (not localhost/127.0.0.1) — refusing to start. The bypass trusts any x-foldrun-tenant header as that account's owner, a cross-tenant hole anywhere the internet can reach. Unset FOLDRUN_DEV_NO_AUTH, or point FOLDRUN_PUBLIC_URL at localhost for local work.`;
    }
  }

  return null;
}
