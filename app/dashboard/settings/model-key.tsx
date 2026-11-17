"use client";

// What the account's steps run on (PUT/DELETE /api/account/model): its own
// model key, or — where the platform offers them — foldrun's models, the
// platform's keys for one provider, billed in credits at the price list.
// The own key is sent once and never shown again — only its last four
// characters. Choosing foldrun's models leaves a stored key where it is, so
// switching back is one click.

import { $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Chip, Field, SettingsCard } from "@foldrun/ui/react/page";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import type { AccountModel } from "@/server/account-model";
import type { FoldrunModelsView } from "@/platform/model-choice";

export type AccountModelView = AccountModel & { foldrunModels: FoldrunModelsView };

const usd = (n: number) => `$${n === 0 || n >= 0.01 ? n.toFixed(2) : n.toFixed(4)}`;

export function ModelKey({
  tenant,
  initial,
  presets,
  mayEdit,
}: {
  tenant: string;
  initial: AccountModelView;
  presets: { name: string; title: string; needsBaseUrl: boolean }[];
  mayEdit: boolean;
}) {
  const router = useRouter();
  const [model, setModel] = useState<AccountModelView>(initial);
  const fm = model.foldrunModels;
  const ready = fm.providers.filter((p) => p.available);
  // Which panel is open: what the account runs on now, until the person
  // picks the other one (nothing changes until they save).
  const [mode, setMode] = useState<"own" | "foldrun">(initial.source);
  const [supply, setSupply] = useState<string>(initial.supply ?? ready[0]?.name ?? "anthropic");
  const [provider, setProvider] = useState(initial.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [format, setFormat] = useState("anthropic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = presets.find((p) => p.name === provider);
  const custom = provider === "custom";
  const showBaseUrl = custom || Boolean(preset?.needsBaseUrl);

  const send = async (method: "PUT" | "DELETE", choice?: { source: "own" | "foldrun"; supply?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const body = choice
        ? { ...choice, ifVersion: model.choiceVersion }
        : {
            provider,
            apiKey,
            ...(showBaseUrl ? { baseUrl } : {}),
            ...(custom ? { format } : {}),
            // A key saved from this panel is one the person means to run on.
            ...(model.source === "foldrun" ? { source: "own", ifVersion: model.choiceVersion } : {}),
          };
      const res = await fetch("/api/account/model", {
        method,
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
        body: method === "PUT" ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as AccountModelView & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModel(data);
      setApiKey("");
      // The no-key banner and Getting started are drawn by the server; ask
      // for them again so a saved key clears them and a removed one brings
      // them back (FOL-15).
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const chosen = fm.providers.find((p) => p.name === model.supply);
  const status =
    model.runsOn === "foldrun"
      ? fm.refused || !chosen?.available
        ? { label: $t("settings.model-key.foldrunSModelsRefused"), variant: "bad" as const, text: $t("settings.model-key.runsAreRefusedUntilThisIs", { v0: String(chosen?.title ?? model.supply), v1: String(fm.refused ?? chosen?.reason ?? $t("settings.model-key.notAvailable2")) }) }
        : { label: $t("settings.model-key.foldrunSModels"), variant: "good" as const, text: $t("settings.model-key.billedInCreditsAtThePrice", { title: String(chosen.title) }) }
      : model.runsOn === "subscription"
      ? { label: $t("settings.model-key.claudeSubscription"), variant: "good" as const, text: $t("settings.model-key.claudeOnYourClaudeCodePlan") }
      : model.runsOn === "account"
      ? { label: $t("settings.model-key.yourOwnKey"), variant: "good" as const, text: `${model.provider ?? "custom"} ${model.keyHint ?? ""} · ${model.baseUrl ?? ""}` }
      : model.runsOn === "platform"
        ? { label: $t("settings.model-key.platformKey"), variant: "warn" as const, text: $t("settings.model-key.thisAccountRunsOnThePlatform") }
        : { label: $t("settings.model-key.noKey"), variant: "bad" as const, text: $t("settings.model-key.runsOnThisAccountAreRefused") };

  return (
    <SettingsCard
      id="model-key"
      title={$t("settings.model-key.modelKey")}
      description={$t("settings.model-key.whatEveryStepOnThisAccount")}
      hint={error ? <span role="alert" className="text-danger">{error}</span> : <>{$rich("settings.model-key.anAgentTermOrAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
        <Chip tone={status.variant}>{status.label}</Chip>
        <span className="min-w-0 break-all font-mono text-xs text-fg-muted">{status.text}</span>
      </div>
      {fm.offered && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={$t("settings.model-key.whatThisAccountRunsOn")}>
          {(
            [
              { id: "own", title: $t("settings.model-key.yourOwnApiKey"), text: $t("settings.model-key.youPayYourProviderDirectlyAny") },
              { id: "foldrun", title: $t("settings.model-key.foldrunSModels"), text: $t("settings.model-key.noProviderAccountNeededBilledIn") },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mode === o.id}
              onClick={() => setMode(o.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${mode === o.id ? "border-fg bg-sunken" : "border-line bg-surface hover:border-line-strong"}`}
            >
              <span className="block text-sm font-medium text-fg">
                {o.title}
                {(o.id === "foldrun" ? model.runsOn === "foldrun" : model.runsOn === "account") && <span className="ml-2 text-xs font-normal text-success">{$t("settings.model-key.inUse")}</span>}
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">{o.text}</span>
            </button>
          ))}
        </div>
      )}
      {mode === "foldrun" && fm.offered ? (
        <FoldrunPanel
          fm={fm}
          supply={supply}
          setSupply={setSupply}
          inUse={model.source === "foldrun" ? model.supply : null}
          mayEdit={mayEdit}
          busy={busy}
          onUse={() => void send("PUT", { source: "foldrun", supply })}
        />
      ) : (
        <>
          <p className="mt-4 text-sm text-fg-muted">
            {$rich("settings.model-key.everyStepRunsOnThisKey2", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code>, strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        {mayEdit && (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("PUT");
            }}
          >
            <Field label={$t("settings.model-key.provider")}>
              <Select className="w-full" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.title}</option>
                ))}
                <option value="custom">{$t("settings.model-key.customEndpoint")}</option>
              </Select>
            </Field>
            <Field label={$t("settings.model-key.apiKey")}>
              <Input type="password" autoComplete="off" required className="font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={model.set ? $t("settings.model-key.replaceTheCurrentKey") : $t("settings.model-key.pasteYourApiKey")} />
            </Field>
            {showBaseUrl && (
              <Field label={$t("settings.model-key.baseUrl")} className="sm:col-span-2">
                <Input type="url" required className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
              </Field>
            )}
            {custom && (
              <Field label={$t("settings.model-key.format")}>
                <Select className="w-full" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="anthropic">{$t("settings.model-key.anthropicMessages")}</option>
                  <option value="openai">{$t("settings.model-key.openaiChatCompletions")}</option>
                </Select>
              </Field>
            )}
            <div className="flex items-end gap-2 sm:col-span-2">
              <button type="submit" disabled={busy || !apiKey} className={buttonVariants({ variant: "primary" })}>{model.source === "foldrun" ? $t("settings.model-key.saveKeyAndUseIt") : model.set ? $t("settings.model-key.replaceKey") : $t("settings.model-key.saveKey")}</button>
              {model.set && (
                <button type="button" disabled={busy} onClick={() => void send("DELETE")} className={buttonVariants({ variant: "secondary" })}>{$t("settings.model-key.remove")}</button>
              )}
            </div>
          </form>
        )}
          {model.source === "foldrun" && mayEdit && (
            <button type="button" disabled={busy} onClick={() => void send("PUT", { source: "own" })} className={`mt-2 ${buttonVariants({ variant: "secondary" })}`}>
              {model.set ? $t("settings.model-key.useMyKeyInsteadOfFoldrun", { v0: String(model.keyHint ?? "") }) : $t("settings.model-key.stopUsingFoldrunSModels")}
            </button>
          )}
        </>
      )}
    </SettingsCard>
  );
}

/** foldrun's models: pick a provider, see what it costs, use it. */
function FoldrunPanel({
  fm,
  supply,
  setSupply,
  inUse,
  mayEdit,
  busy,
  onUse,
}: {
  fm: FoldrunModelsView;
  supply: string;
  setSupply: (s: string) => void;
  inUse: string | null;
  mayEdit: boolean;
  busy: boolean;
  onUse: () => void;
}) {
  const p = fm.providers.find((x) => x.name === supply);
  const prices = fm.prices.filter((x) => x.provider === supply);
  const tiers = Object.entries(p?.tiers ?? {});
  const priced = new Set(prices.map((x) => x.model));
  return (
    <div className="mt-3 grid min-w-0 gap-3">
      {fm.refused && <p className="text-sm text-danger">{fm.refused}</p>}
      <Field label={$t("settings.model-key.provider")} className="sm:w-64">
        <Select className="w-full" value={supply} onChange={(e) => setSupply(e.target.value)}>
          {fm.providers.map((x) => (
            <option key={x.name} value={x.name} disabled={!x.available}>
              {x.title}
              {x.available ? "" : $t("settings.model-key.notAvailable")}
            </option>
          ))}
        </Select>
      </Field>
      {tiers.length > 0 && (
        <p className="text-xs text-fg-muted">
          <span className="mr-1.5">{$rich("settings.model-key.anAgentSModel", { code: (chunks) => <code className="font-mono">{chunks}</code> })}</span>
          {tiers.map(([tier, m], i) => (
            <span key={tier}>
              {i > 0 && <span className="mx-1.5 text-fg-subtle">·</span>}
              <code className="font-mono">{tier}</code> → <code className="font-mono">{m}</code>
              {!priced.has(m) && <span className="ml-1 text-danger">{$t("settings.model-key.notPricedRefused")}</span>}
            </span>
          ))}
        </p>
      )}
      {prices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-fg-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">{$t("settings.model-key.model")}</th>
                <th className="py-1 pr-3 font-medium">{$t("settings.model-key.in")}</th>
                <th className="py-1 pr-3 font-medium">{$t("settings.model-key.out")}</th>
                <Tooltip label={$t("settings.model-key.cacheRead")}>
                  <th className="py-1 pr-3 font-medium">{$t("settings.model-key.cachedIn")}</th>
                </Tooltip>
                <th className="py-1 font-medium">{$t("settings.model-key.cacheWrite")}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-fg-secondary">
              {prices.map((x) => (
                <tr key={x.model} className="border-t border-line-faint">
                  <td className="py-1 pr-3 text-fg">{x.model}</td>
                  <td className="py-1 pr-3">{usd(x.inputPerMTok)}</td>
                  <td className="py-1 pr-3">{usd(x.outputPerMTok)}</td>
                  <td className="py-1 pr-3">{x.cacheReadPerMTok === null ? "—" : usd(x.cacheReadPerMTok)}</td>
                  <td className="py-1">{x.cacheWritePerMTok === null ? "—" : usd(x.cacheWritePerMTok)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-fg-subtle">{$t("settings.model-key.usdPerMillionTokensOfInput")}</p>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{$t("settings.model-key.noModelsArePricedForThis")}</p>
      )}
      <p className="text-xs text-fg-muted">
        {$rich("settings.model-key.spentToday", { usd: usd(fm.spentTodayUsd), span: (chunks) => <span className="font-mono text-fg">{chunks}</span> })}
        {fm.dailyCapUsd !== null ? (
          <>
            {" "}{$rich("settings.model-key.ofADailyCapUtcCalls", { usd: usd(fm.dailyCapUsd), span: (chunks) => <span className="font-mono text-fg">{chunks}</span> })}
          </>
        ) : (
          $t("settings.model-key.noDailyCap")
        )}{" "}{$t("settings.model-key.chargedFromYourCreditBalanceCalls")}
      </p>
      {mayEdit && (
        <div>
          <button type="button" disabled={busy || !p?.available || Boolean(fm.refused) || inUse === supply} onClick={onUse} className={buttonVariants({ variant: "primary" })}>
            {inUse === supply ? $t("settings.model-key.runningOn", { v0: String(p?.title ?? supply) }) : $t("settings.model-key.useFoldrunSModels", { v0: String(p?.title ?? supply) })}
          </button>
        </div>
      )}
    </div>
  );
}
