// Gateway keys (10 Nov 2026), as the key list shows them: where the gateway
// is, whether this install offers it, and what each gateway key has spent.
// The spend is the platform's own record (model_usage, job `gateway:<id>`,
// open estimates included) — the same sums the gateway door's limits read.

import { databaseEnabled } from "@/platform/db";
import { dayOf, spentByJob } from "@/platform/model-usage";
import { billing } from "@/platform/billing";

/** The gateway's address, for ANTHROPIC_BASE_URL: FOLDRUN_GATEWAY_URL, or
 *  null where this install has none (infra routes a host to the door). */
export function gatewayUrl(): string | null {
  return process.env.FOLDRUN_GATEWAY_URL?.trim().replace(/\/+$/, "") || null;
}

/** Whether a gateway key may be minted here: the door reads its keys from
 *  the platform's database. */
export const gatewayOffered = (): boolean => databaseEnabled();

export interface GatewaySpend {
  capUsd: number | null;
  dailyUsd: number | null;
  spentUsd: number;
  todayUsd: number;
}

/** Each gateway key with what it has spent in all and today (UTC). */
export async function withGatewaySpend<K extends { id: string; tenant: string; purpose?: string; gateway?: { capUsd: number | null; dailyUsd: number | null } }>(keys: K[], now = new Date()): Promise<(K | (K & { gateway: GatewaySpend }))[]> {
  const day = dayOf(now);
  return Promise.all(
    keys.map(async (k) => {
      if (k.purpose !== "gateway" || !k.gateway) return k;
      const job = `gateway:${k.id}`;
      // As charged (the price list × the margin), the unit the limits are in.
      const [spentUsd, todayUsd] = (await Promise.all([spentByJob(k.tenant, job), spentByJob(k.tenant, job, day)])).map((usd) => billing().modelChargeOf?.(usd) ?? usd);
      return { ...k, gateway: { capUsd: k.gateway.capUsd ?? null, dailyUsd: k.gateway.dailyUsd ?? null, spentUsd, todayUsd } };
    }),
  );
}
