// Which part of the product this process serves (27 Oct 2026).
//
// One build can run as more than one Deployment: the customer app, and — on
// the hosted platform — the operator console on its own hostname behind
// Cloudflare Access (and later customer billing on its own container). The
// surface decides which sessions are accepted and which origin a write must
// come from; FOLDRUN_ROLE still decides which loops the process runs.
//
//   FOLDRUN_SURFACE   app (default) | admin | billing
//   FOLDRUN_ADMIN_URL the console's origin, e.g. https://admin.foldrun.io

export type Surface = "app" | "admin" | "billing";

export function surface(): Surface {
  const s = (process.env.FOLDRUN_SURFACE ?? "").trim() || "app";
  if (s === "app" || s === "admin" || s === "billing") return s;
  // A typo must not quietly serve the wrong thing — or the console with the
  // customer app's looser rules.
  throw new Error(`FOLDRUN_SURFACE must be app, admin or billing, not "${s}"`);
}

/** The console's origin, when the install has one. */
export function adminOrigin(): string | null {
  const raw = process.env.FOLDRUN_ADMIN_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : null;
  } catch {
    return null;
  }
}
