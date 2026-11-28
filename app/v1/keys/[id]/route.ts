// PATCH /v1/keys/<id> { models } — change a gateway key's model map (Part A5
// of the coding-API plan, 10 Nov 2026): which model Claude Code's Opus,
// Sonnet and Haiku run on for that key, e.g. { sonnet: "openai/gpt-6" }.
// `models: null` clears it. Only a gateway key; only an admin of every
// workspace (a gateway key spends the whole account's balance, as minting
// one does). The gateway reads the change within its key cache (10 s).

import { NextRequest, NextResponse } from "next/server";
import { listApiKeys, setRequireCustomer, deleteApiKey } from "@/server/auth";
import { keyWithin } from "@/server/key-scope";
import { errorResponse, requirePermission, ApiError, refuse } from "@/server/api";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";
import { checkModels, gatewayOffered } from "@/server/gateway-keys";
import { modelGrantOf, patchGatewayGrantDb } from "@/platform/api-keys-db";
import { walletAmount } from "@/server/gateway-keys";
import { jsonObject } from "@/server/body";

async function patchOnce(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "keys:manage");
    if (actor.workspaces !== null) return refuse("only an admin of every workspace may change a key here", 403);
    if ("models" in ((await req.clone().json().catch(() => ({}))) as Record<string, unknown>) && !gatewayOffered()) return refuse("gateway keys are for the hosted platform", 400);
    let body: Record<string, unknown>;
    try {
      body = ((await jsonObject(req)) ?? {}) as Record<string, unknown>;
    } catch {
      throw new ApiError("expected a JSON body { models }", 400);
    }
    const unknown = Object.keys(body).filter((k) => k !== "models" && k !== "requireCustomer" && k !== "walletUsd" && k !== "mediaToText");
    if (unknown.length) return refuse(`only models, requireCustomer, walletUsd and mediaToText may be changed here — not ${unknown.join(", ")}`, 400);
    if (!("models" in body) && !("requireCustomer" in body) && !("walletUsd" in body) && !("mediaToText" in body)) return refuse("expected { models: { opus?, sonnet?, haiku? } | null }, { requireCustomer: true | false } or { walletUsd }", 400);
    const key = (await listApiKeys(tenant)).find((k) => k.id === id);
    if (!key || key.revokedAt) return refuse("key not found", 404);
    // Images and PDFs read into text before the call (FOL-268), alone in its request.
    if ("mediaToText" in body) {
      if (Object.keys(body).length > 1) return refuse("change mediaToText on its own", 400);
      if (typeof body.mediaToText !== "boolean") return refuse("mediaToText is true or false", 400);
      if (!modelGrantOf(key) || !key.gateway) return refuse("only a gateway key, or an API key with model access, makes model calls", 400);
      if (!(await patchGatewayGrantDb(tenant, id, "mediaToText", body.mediaToText ? true : null))) return refuse("key not found", 404);
      await audit("apikey.media_to_text", { actor: actor.name, tenant, subject: id, detail: { label: key.label, prefix: key.prefix, mediaToText: body.mediaToText } });
      return NextResponse.json({ ok: true, id, mediaToText: body.mediaToText });
    }
    // An account key's wallet budget (FOL-208), alone in its request.
    if ("walletUsd" in body) {
      if (Object.keys(body).length > 1) return refuse("change walletUsd on its own", 400);
      // A gateway account key, or an API key with model access (one key).
      if (!modelGrantOf(key) || key.gateway?.credential !== "account") return refuse("only an account key (credential: account) or an API key with model access has a wallet budget", 400);
      // null clears the key's own amount: the account's pay-as-you-go terms decide (28 Nov 2026).
      const n = body.walletUsd === null ? null : walletAmount(body.walletUsd);
      if (n === null && body.walletUsd !== null) return refuse("walletUsd must be a number of dollars from 0 (the plan only) to 100000, or null for the account's own terms", 400);
      if (!(await patchGatewayGrantDb(tenant, id, "walletUsd", n, "account"))) return refuse("key not found", 404);
      // An API key's chain shares one spend (its principal): a key still in
      // its rotation grace gets the same budget, never the old one (Codex review).
      const chain = key.purpose === undefined ? key.gateway?.principal : undefined;
      if (chain) for (const k of await listApiKeys(tenant)) if (k.id !== id && !k.revokedAt && k.purpose === undefined && k.gateway?.principal === chain) await patchGatewayGrantDb(tenant, k.id, "walletUsd", n, "account");
      await audit("apikey.wallet_budget", { actor: actor.name, tenant, subject: id, detail: { label: key.label, prefix: key.prefix, walletUsd: n } });
      return NextResponse.json({ ok: true, id, walletUsd: n });
    }
    // Everything asked for is checked before anything is written, so a
    // refusal never leaves half the change applied (Codex review).
    if ("requireCustomer" in body) {
      if (typeof body.requireCustomer !== "boolean") return refuse("requireCustomer is true or false", 400);
      if (key.purpose === "a2a") return refuse("an A2A key's caller is one outside agent — requireCustomer is for API and gateway keys", 400);
    }
    const wantsModels = "models" in body;
    const checkedModels = wantsModels
      ? !modelGrantOf(key) || !key.gateway
        ? ({ error: "only a gateway key, or an API key with model access, has a model map" } as const)
        : checkModels(body.models, key.gateway.credential === "login")
      : null;
    if (checkedModels && "error" in checkedModels) return refuse(checkedModels.error, 400);
    // FOL-168: whether its runs and gateway calls must name an end customer.
    if ("requireCustomer" in body) {
      if (!(await setRequireCustomer(tenant, id, body.requireCustomer as boolean))) return refuse("key not found", 404);
      await audit("apikey.require_customer", { actor: actor.name, tenant, subject: id, detail: { label: key.label, prefix: key.prefix, requireCustomer: body.requireCustomer } });
      if (!wantsModels) return NextResponse.json({ ok: true, id, requireCustomer: body.requireCustomer });
    }
    if (!modelGrantOf(key) || !key.gateway) return refuse("only a gateway key, or an API key with model access, has a model map", 400);
    const checked = checkModels(body.models, key.gateway.credential === "login");
    if ("error" in checked) return refuse(checked.error, 400);
    // The model map alone, against the grant as it is now (Codex review).
    if (!(await patchGatewayGrantDb(tenant, id, "models", checked.models ?? null))) return refuse("key not found", 404);
    await audit("apikey.models", { actor: actor.name, tenant, subject: id, detail: { label: key.label, prefix: key.prefix, models: checked.models } });
    return NextResponse.json({ ok: true, id, models: checked.models });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function PATCH(...args: Parameters<typeof patchOnce>) {
  return idempotent(args[0], () => patchOnce(...args));
}

// DELETE /v1/keys/<id> — delete a key (17 Nov 2026: a tester found no way
// to remove one, only to revoke it and see it listed forever). A live key is
// revoked in the same moment, so anything still using it stops at once; a
// revoked or expired one just leaves the list. keys:manage, and only a key
// within the caller's own scope — the rule revoking reads (a key outside it
// is not found rather than refused). Audited as apikey.deleted.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "keys:manage");
    const target = (await listApiKeys(tenant)).find((k) => k.id === id);
    if (!target || !keyWithin(actor, target)) return refuse("key not found", 404);
    if (!(await deleteApiKey(tenant, id))) return refuse("key not found", 404);
    await audit("apikey.deleted", { actor: actor.name, tenant, subject: target.id, detail: { label: target.label, prefix: target.prefix, wasLive: !target.revokedAt } });
    return NextResponse.json({ ok: true, id, revoked: !target.revokedAt });
  } catch (err) {
    return errorResponse(err);
  }
}
