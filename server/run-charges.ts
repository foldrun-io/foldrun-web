// What each run was charged, from the ledger (FOL-54 step 2): the one money
// figure every overview shows. A run the ledger has not settled yet (still
// going, or just finished) is shown at its list price and marked estimated —
// never as the provider's token cost, which is not what anyone is billed.

import { readLedger, attributeToAgents } from "@/platform/ledger";
import { platform } from "@/lib/platform";
import type { RunRecord } from "@/lib/store";

export interface RunCharges {
  /** runId → USD charged (positive), for every settled run of the account. */
  usd: Map<string, number>;
  /** runId → the ledger's split of that charge by agent. */
  agents: Map<string, Record<string, number>>;
}

export async function runCharges(tenant: string): Promise<RunCharges> {
  const out: RunCharges = { usd: new Map(), agents: new Map() };
  try {
    for (const e of await readLedger(tenant)) {
      if (e.kind !== "run" || typeof e.runId !== "string") continue;
      out.usd.set(e.runId, (out.usd.get(e.runId) ?? 0) + Math.max(0, -e.usd));
      if (e.agents) out.agents.set(e.runId, e.agents);
    }
  } catch (err) {
    // An unreadable ledger is not a page error: every run reads as estimated.
    console.error(`[foldrun] run charges for ${tenant}:`, err instanceof Error ? err.message : err);
  }
  return out;
}

/** A run's money: charged once settled, its list price until then. */
export function runCharge(r: RunRecord, charges?: RunCharges): number {
  return charges?.usd.get(r.id) ?? platform.runSpend(r);
}

/** One agent's part of a run's money: the ledger's split once settled; until
 *  then the run's one list price, split as the ledger will split it (pricing
 *  the agent's steps alone would add the run fee per agent — Codex review). */
export function agentCharge(r: RunRecord, agent: string, charges?: RunCharges): number {
  const split = charges?.agents.get(r.id);
  if (split) return split[agent] ?? 0;
  if (charges?.usd.has(r.id)) return 0;
  return attributeToAgents(r.steps, platform.runSpend(r))[agent] ?? 0;
}
