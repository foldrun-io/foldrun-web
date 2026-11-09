// Gateway keys (10 Nov 2026), as the key list shows them: where the gateway
// is, whether this install offers it, and what each gateway key has spent.
// The spend is the platform's own record (model_usage, job `gateway:<id>`,
// open estimates included) — the same sums the gateway door's limits read.

import { databaseEnabled } from "@/platform/db";
import { dayOf, spentByJob } from "@/platform/model-usage";
import { chargeMargin } from "@/platform/model-gateway";
import { loginAllowed } from "@/platform/gateway-door";

/** The gateway's address, for ANTHROPIC_BASE_URL: FOLDRUN_GATEWAY_URL, or
 *  null where this install has none (infra routes a host to the door). */
export function gatewayUrl(): string | null {
  return process.env.FOLDRUN_GATEWAY_URL?.trim().replace(/\/+$/, "") || null;
}

/** Whether a gateway key may be minted here: the door reads its keys from
 *  the platform's database. */
export const gatewayOffered = (): boolean => databaseEnabled();

/** Whether this account may mint a gateway key on the operator's own Claude
 *  login: one the operator allows its model credential (the console's grant
 *  or FOLDRUN_PLATFORM_KEY_ACCOUNTS) — the rule its desks' runs follow. The
 *  gateway's own function, so minting and every call ask the same thing. */
export function gatewayLoginOffered(tenant: string): boolean {
  return gatewayOffered() && loginAllowed(tenant);
}

export interface GatewaySpend {
  capUsd: number | null;
  dailyUsd: number | null;
  spentUsd: number;
  todayUsd: number;
}

/** Each gateway key with what it has spent in all and today (UTC). */
export async function withGatewaySpend<K extends { id: string; tenant: string; purpose?: string; gateway?: { capUsd: number | null; dailyUsd: number | null; credential?: "login" } }>(keys: K[], now = new Date()): Promise<(K | (K & { gateway: GatewaySpend }))[]> {
  const day = dayOf(now);
  return Promise.all(
    keys.map(async (k) => {
      // A login key is not metered: there is no spend to show.
      if (k.purpose !== "gateway" || !k.gateway || k.gateway.credential === "login") return k;
      const job = `gateway:${k.id}`;
      // As charged — each call at the margin it was held at — the unit the
      // limits are in (and the gateway door's own check).
      const m = chargeMargin();
      const [spentUsd, todayUsd] = await Promise.all([spentByJob(k.tenant, job, undefined, m), spentByJob(k.tenant, job, day, m)]);
      return { ...k, gateway: { capUsd: k.gateway.capUsd ?? null, dailyUsd: k.gateway.dailyUsd ?? null, spentUsd, todayUsd } };
    }),
  );
}
