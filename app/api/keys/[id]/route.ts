// PATCH /api/keys/<id> { models } — change a gateway key's model map (Part A5
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
import { setGatewayGrantDb } from "@/platform/api-keys-db";
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
    const unknown = Object.keys(body).filter((k) => k !== "models" && k !== "requireCustomer");
    if (unknown.length) return refuse(`only models and requireCustomer may be changed here — not ${unknown.join(", ")}`, 400);
    if (!("models" in body) && !("requireCustomer" in body)) return refuse("expected { models: { opus?, sonnet?, haiku? } | null } or { requireCustomer: true | false }", 400);
    const key = (await listApiKeys(tenant)).find((k) => k.id === id);
    if (!key || key.revokedAt) return refuse("key not found", 404);
    // Everything asked for is checked before anything is written, so a
    // refusal never leaves half the change applied (Codex review).
    if ("requireCustomer" in body) {
      if (typeof body.requireCustomer !== "boolean") return refuse("requireCustomer is true or false", 400);
      if (key.purpose === "a2a") return refuse("an A2A key's caller is one outside agent — requireCustomer is for API and gateway keys", 400);
    }
    const wantsModels = "models" in body;
    const checkedModels = wantsModels
      ? key.purpose !== "gateway" || !key.gateway
        ? ({ error: "only a gateway key has a model map" } as const)
        : checkModels(body.models, key.gateway.credential === "login")
      : null;
    if (checkedModels && "error" in checkedModels) return refuse(checkedModels.error, 400);
    // FOL-168: whether its runs and gateway calls must name an end customer.
    if ("requireCustomer" in body) {
      if (!(await setRequireCustomer(tenant, id, body.requireCustomer as boolean))) return refuse("key not found", 404);
      await audit("apikey.require_customer", { actor: actor.name, tenant, subject: id, detail: { label: key.label, prefix: key.prefix, requireCustomer: body.requireCustomer } });
      if (!wantsModels) return NextResponse.json({ ok: true, id, requireCustomer: body.requireCustomer });
    }
    if (key.purpose !== "gateway" || !key.gateway) return refuse("only a gateway key has a model map", 400);
    const checked = checkModels(body.models, key.gateway.credential === "login");
    if ("error" in checked) return refuse(checked.error, 400);
    const { models: _old, ...rest } = key.gateway;
    void _old;
    const next = { ...rest, ...(checked.models ? { models: checked.models } : {}) };
    if (!(await setGatewayGrantDb(tenant, id, next))) return refuse("key not found", 404);
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

// DELETE /api/keys/<id> — delete a key (17 Nov 2026: a tester found no way
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
