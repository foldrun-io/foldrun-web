// Who may read more than "ok" from the open probes (/api/healthz,
// /api/version). A stranger — a port scanner, a bot, a prompt-injected agent
// fetching the public address — learns that the platform answers and which
// release name and API date it speaks, and nothing else: no commit shas, no
// release time, and not whether the database, Redis or a worker is up, which
// is exactly what someone choosing a moment to attack wants to know.
//
// The rest is for:
//   · an account's API key of any role, or a signed-in session — a member
//     already sees all of it on Settings and What's new, and the CLI's
//     `version`, `doctor` and `check` read it;
//   · the scraper's token (FOLDRUN_METRICS_TOKEN), which is how a monitor or
//     a deploy smoke test reads the dependency flags without an account.
// A key that opens no /api route (A2A, gateway) opens no detail either.
//
// A request with no credential at all never reaches the key lookup, so the
// open, unmetered probes cost no more than before.

import type { NextRequest } from "next/server";
import { resolveTenant } from "./auth.ts";
import { SESSION_COOKIE } from "./users.ts";
import { sameToken } from "./limits.ts";

export async function mayReadProbeDetail(req: NextRequest): Promise<boolean> {
  const authz = req.headers.get("authorization");
  const scraper = process.env.FOLDRUN_METRICS_TOKEN;
  if (scraper && authz && sameToken(authz.replace(/^bearer\s+/i, "").trim(), scraper)) return true;
  if (!authz && !req.cookies.get(SESSION_COOKIE)?.value && process.env.FOLDRUN_DEV_NO_AUTH !== "1") return false;
  try {
    return (await resolveTenant(req)).tenant !== null;
  } catch {
    return false;
  }
}
