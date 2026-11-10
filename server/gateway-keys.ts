// Gateway keys (10 Nov 2026), as the key list shows them: where the gateway
// is, whether this install offers it, and what each gateway key has spent.
// The spend is the platform's own record (model_usage, job `gateway:<id>`,
// open estimates included) — the same sums the gateway door's limits read.

import { databaseEnabled } from "@/platform/db";
import { dayOf, spentByJob } from "@/platform/model-usage";
import { chargeMargin } from "@/platform/model-gateway";
import { loginAllowed, providerOfModel } from "@/platform/gateway-door";
import { billing } from "@/platform/billing";
import type { GatewayModels } from "@/platform/api-keys-db";

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

const TIERS = ["opus", "sonnet", "haiku"] as const;

/**
 * A gateway key's model map (Part A5), checked: an object of the tiers
 * Claude Code names (opus, sonnet, haiku), each a model the gateway serves —
 * `provider/model` or a known prefix — that foldrun's price list prices (a
 * call on it would be refused otherwise). A login key maps to Claude models
 * only: the operator's Claude login pays for nothing else. Null clears it.
 */
export function checkModels(input: unknown, login: boolean, priced = (provider: string, model: string) => Boolean(billing().modelPrice?.(provider, model))): { models: GatewayModels | null } | { error: string } {
  if (input === null) return { models: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "models must be an object: { opus?, sonnet?, haiku? }, each a model such as openai/gpt-6 — or null to clear" };
  const out: GatewayModels = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(TIERS as readonly string[]).includes(k)) return { error: `models: ${k} is not a tier — opus, sonnet or haiku` };
    if (v === null || v === "") continue;
    if (typeof v !== "string" || v.length > 120) return { error: `models.${k} must be a model name` };
    const r = providerOfModel(v.trim());
    if (!r) return { error: `models.${k}: ${v} names no provider foldrun offers — write anthropic/, openai/, gemini/, deepseek/, kimi/, zai/, qwen/, minimax/ or mimo/ before the model` };
    if (login && r.provider !== "anthropic") return { error: `models.${k}: a login gateway key runs on the operator's Claude login — Claude models only` };
    if (!login && !priced(r.provider, r.model)) return { error: `models.${k}: ${v} has no price on foldrun's models — pick a model on the price list (\`foldrun account model prices\`)` };
    out[k as (typeof TIERS)[number]] = v.trim();
  }
  return { models: Object.keys(out).length ? out : null };
}

export interface GatewaySpend {
  capUsd: number | null;
  dailyUsd: number | null;
  spentUsd: number;
  todayUsd: number;
}

/** Each gateway key with what it has spent in all and today (UTC). */
export async function withGatewaySpend<K extends { id: string; tenant: string; purpose?: string; gateway?: { capUsd: number | null; dailyUsd: number | null; credential?: "login"; models?: GatewayModels } }>(keys: K[], now = new Date()): Promise<(K | (K & { gateway: GatewaySpend }))[]> {
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
      // The whole grant (its model map included), plus what it has spent.
      return { ...k, gateway: { ...k.gateway, capUsd: k.gateway.capUsd ?? null, dailyUsd: k.gateway.dailyUsd ?? null, spentUsd, todayUsd } };
    }),
  );
}
