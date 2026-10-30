// The model providers an account's files use, and the last check of each —
// as GET /api/account/providers and the Settings page both show them. A
// caller scoped to some workspaces sees the account's own blocks (its runs
// use them too) and its workspaces' — not the names of the workspaces and
// agents it was not given, nor the gateways they use (30 Oct 2026).

import { providersInUse } from "@/lib/provider-health";
import { lastProviderCheck } from "@/platform/watchdog";
import { scopeAllows } from "@/platform/scope";

export async function providerFactsFor(tenant: string, workspaces: string[] | null) {
  const inUse = providersInUse(tenant);
  const visible = (workspace: string | null) => workspaces === null || workspace === null || scopeAllows(workspaces, workspace);
  // A check's results name where each block is declared, not its workspace:
  // read that back from the blocks in use. One no block declares any more
  // (since removed) is shown only to a caller who sees everything.
  const shown = new Map<string, boolean>();
  for (const p of inUse) shown.set(p.declaredIn, (shown.get(p.declaredIn) ?? true) && visible(p.workspace));
  const last = await lastProviderCheck(tenant);
  return {
    configured: inUse.filter((p) => visible(p.workspace)).map((p) => ({
      provider: p.spec.name || p.spec.baseUrl,
      declaredIn: p.declaredIn,
      model: p.model,
      format: p.spec.format,
    })),
    lastCheck: last && workspaces !== null ? { ...last, results: last.results.filter((r) => shown.get(r.declaredIn) === true) } : last,
  };
}
