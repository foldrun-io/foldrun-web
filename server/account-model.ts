// What the account's own model key is, for the API (/api/account/model) and
// the Settings page alike — one summary, never the key itself.

import { getSecret } from "@/lib/secrets";
import { ACCOUNT_MODEL_SECRETS } from "@/lib/model-credential";
import { providerPreset, PROVIDERS } from "@/lib/providers";
import { platform } from "@/lib/platform";
import { accountDir, parseProvider } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";

export interface AccountModel {
  set: boolean;
  provider: string | null;
  baseUrl: string | null;
  format: string | null;
  /** The key's last four characters, so a person can tell which key it is. */
  keyHint: string | null;
  /** What a step with no provider: block runs on today. */
  runsOn: "account" | "platform" | "none";
  platformKeyAllowed: boolean;
}

export function describeAccountModel(tenant: string): AccountModel {
  const read = (n: string) => getSecret(tenant, n)?.value ?? null;
  const key = read(ACCOUNT_MODEL_SECRETS.key);
  const provider = read(ACCOUNT_MODEL_SECRETS.provider);
  const baseUrl = read(ACCOUNT_MODEL_SECRETS.baseUrl);
  const format = read(ACCOUNT_MODEL_SECRETS.format);
  const platformKey = platform.platformKeyAllowed(tenant);
  return {
    set: Boolean(key),
    provider: key ? provider ?? (baseUrl ? "custom" : null) : null,
    baseUrl: key ? baseUrl ?? providerPreset(provider)?.baseUrl ?? null : null,
    format: key ? format ?? providerPreset(provider)?.format ?? "anthropic" : null,
    keyHint: key ? `…${key.slice(-4)}` : null,
    runsOn: key ? "account" : platformKey ? "platform" : "none",
    platformKeyAllowed: platformKey,
  };
}

/**
 * What a step that names no provider: of its own runs on, in the account's
 * terms: its own key, a provider: block in the account's AGENTS.md, the
 * platform's credential, or nothing — in which case the runner refuses the
 * step (runner.ts, model-env.ts). The onboarding step and the dashboard's
 * banner read this, so they say what the runner will do. A provider: in one
 * workspace's AGENTS.md covers that workspace alone and is not counted.
 */
export function accountModelSupply(tenant: string): "account" | "provider" | "platform" | "none" {
  if (getSecret(tenant, ACCOUNT_MODEL_SECRETS.key)?.value) return "account";
  if (parseProvider(readAgentsMdKeys(accountDir(tenant)).provider)?.baseUrl) return "provider";
  return platform.platformKeyAllowed(tenant) ? "platform" : "none";
}

/** The presets a person can pick, for the form: name, title, and whether the
 *  address is per account (a base URL must be typed). */
export function modelPresetChoices(): { name: string; title: string; needsBaseUrl: boolean }[] {
  return PROVIDERS.map((p) => ({ name: p.name, title: p.title ?? p.name, needsBaseUrl: !p.baseUrl }));
}
