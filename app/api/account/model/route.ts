// The account's own model key — what every step runs on unless a provider:
// block says otherwise. On a hosted platform this is how a customer brings
// their key (the platform's own credential is for the operator's accounts,
// FOLDRUN_PLATFORM_KEY_ACCOUNTS); on a laptop it is an alternative to a block.
//
// Stored as account secrets (core model-credential.ts ACCOUNT_MODEL_SECRETS),
// so it is encrypted under the account's key like every other credential and
// read by the runner the way a provider block's ${SECRET} is.
//
//   GET     what is set (never the key, only its last four), and what runs
//   PUT     { provider, apiKey, baseUrl?, format? } — a preset name
//           (anthropic, openrouter, openai, groq, …) or a custom base URL
//   DELETE  removes it
//
// A Claude login token (sk-ant-oat…) is refused for any account not allowed
// the platform's credential: customers bring API keys, not claude.ai logins.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requireAccountWide } from "@/server/api";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";
import { setSecret, deleteSecret } from "@/lib/secrets";
import { describeAccountModel as describe } from "@/server/account-model";
import { ACCOUNT_MODEL_SECRETS, isClaudeLoginToken } from "@/lib/model-credential";
import { providerPreset } from "@/lib/providers";
import { platform, guardsUntrustedUrls } from "@/lib/platform";
import { refuseInternalUrl } from "@/platform/ssrf";

export const dynamic = "force-dynamic";

const FORMATS = ["anthropic", "openai"] as const;

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant(req);
    return NextResponse.json(describe(tenant));
  } catch (err) {
    return errorResponse(err);
  }
}

async function putOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requireAccountWide(req, "secrets:write");
    const body = (await req.json().catch(() => ({}))) as { provider?: string; apiKey?: string; baseUrl?: string; format?: string };
    const apiKey = (body.apiKey ?? "").trim();
    const name = (body.provider ?? "").trim().toLowerCase();
    const baseUrl = (body.baseUrl ?? "").trim();
    const format = (body.format ?? "").trim().toLowerCase();
    const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
    if (!apiKey) return bad("expected { provider, apiKey } — apiKey is the key from your provider");
    if (isClaudeLoginToken(apiKey) && !platform.platformKeyAllowed(tenant)) {
      return bad("that is a Claude login token (sk-ant-oat…), not an API key — create an API key at your provider and use that");
    }
    const preset = name && name !== "custom" ? providerPreset(name) : null;
    if (name && name !== "custom" && !preset) return bad(`unknown provider "${name}" — use a preset name (anthropic, openrouter, openai, groq, …) or "custom" with a baseUrl`);
    if (!preset && !baseUrl) return bad("a custom provider needs baseUrl — the endpoint your key is for");
    if (baseUrl && !/^https:\/\//.test(baseUrl)) return bad("baseUrl must be an https:// URL");
    // The host calls this URL for a judge, a draft, the assistant: on a
    // platform, never a private or cluster address (FOL-95). The guard checks
    // every request again; this is so the person hears it now, not later.
    const refused = baseUrl ? ((guardsUntrustedUrls() ? refuseInternalUrl(baseUrl) : null) ?? (await platform.checkUntrustedUrl(baseUrl))) : null;
    if (refused) return bad(`baseUrl refused: ${refused}`);
    if (preset && !preset.baseUrl && !baseUrl) return bad(`${preset.name} needs a baseUrl — ${preset.note ?? "its address is per account"}`);
    if (format && !(FORMATS as readonly string[]).includes(format)) return bad(`format is anthropic or openai`);

    setSecret(tenant, ACCOUNT_MODEL_SECRETS.key, apiKey);
    if (preset) setSecret(tenant, ACCOUNT_MODEL_SECRETS.provider, preset.name);
    else deleteSecret(tenant, ACCOUNT_MODEL_SECRETS.provider);
    if (baseUrl) setSecret(tenant, ACCOUNT_MODEL_SECRETS.baseUrl, baseUrl);
    else deleteSecret(tenant, ACCOUNT_MODEL_SECRETS.baseUrl);
    if (format) setSecret(tenant, ACCOUNT_MODEL_SECRETS.format, format);
    else deleteSecret(tenant, ACCOUNT_MODEL_SECRETS.format);
    // The provider, never the key.
    await audit("model.key_set", { actor: actor.name, tenant, subject: preset?.name ?? "custom", detail: { provider: preset?.name ?? "custom", ...(baseUrl ? { baseUrl } : {}) } });
    return NextResponse.json({ ok: true, ...describe(tenant) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function PUT(...args: Parameters<typeof putOnce>) {
  return idempotent(args[0], () => putOnce(...args));
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenant, actor } = await requireAccountWide(req, "secrets:write");
    for (const n of Object.values(ACCOUNT_MODEL_SECRETS)) deleteSecret(tenant, n);
    await audit("model.key_removed", { actor: actor.name, tenant });
    return NextResponse.json({ ok: true, ...describe(tenant) });
  } catch (err) {
    return errorResponse(err);
  }
}
