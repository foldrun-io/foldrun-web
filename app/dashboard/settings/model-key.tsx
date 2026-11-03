"use client";

// What the account's steps run on (PUT/DELETE /api/account/model): its own
// model key, or — where the platform offers them — foldrun's models, the
// platform's keys for one provider, billed in credits at the price list.
// The own key is sent once and never shown again — only its last four
// characters. Choosing foldrun's models leaves a stored key where it is, so
// switching back is one click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, buttonClass } from "@/components/ui";
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
        ? { label: "foldrun's models — refused", variant: "error" as const, text: `${chosen?.title ?? model.supply}: ${fm.refused ?? chosen?.reason ?? "not available"}. Runs are refused until this is resolved or you switch to your own key.` }
        : { label: "foldrun's models", variant: "success" as const, text: `${chosen.title} · billed in credits at the price list` }
      : model.runsOn === "account"
      ? { label: "Your own key", variant: "success" as const, text: `${model.provider ?? "custom"} ${model.keyHint ?? ""} · ${model.baseUrl ?? ""}` }
      : model.runsOn === "platform"
        ? { label: "Platform key", variant: "warning" as const, text: "This account runs on the platform's own credential." }
        : { label: "No key", variant: "error" as const, text: "Runs on this account are refused until you add an API key." };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="font-mono text-xs text-fg-muted">{status.text}</span>
      </div>
      {fm.offered && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What this account runs on">
          {(
            [
              { id: "own", title: "Your own API key", text: "You pay your provider directly. Any provider, any model." },
              { id: "foldrun", title: "foldrun's models", text: "No provider account needed. Billed in credits at foldrun's price list." },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mode === o.id}
              onClick={() => setMode(o.id)}
              className={`rounded border p-3 text-left ${mode === o.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-muted"}`}
            >
              <span className="block text-sm font-medium text-fg">
                {o.title}
                {(o.id === "foldrun" ? model.runsOn === "foldrun" : model.runsOn === "account") && <span className="ml-2 text-xs font-normal text-fg-subtle">in use</span>}
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
          <p className="mt-3 text-sm text-fg-tertiary">
            Every step runs on this key unless an agent, workspace or the account&apos;s AGENTS.md names its own <code className="font-mono text-xs">provider:</code>.
            Use an <strong>API key</strong> from your provider; Claude login tokens are not accepted.
          </p>
        {mayEdit && (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("PUT");
            }}
          >
            <label className="grid gap-1 text-xs text-fg-secondary">
              Provider
              <select className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-fg" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.title}</option>
                ))}
                <option value="custom">Custom endpoint…</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-fg-secondary">
              API key
              <input type="password" autoComplete="off" required className="rounded border border-line bg-surface px-2 py-1.5 font-mono text-sm text-fg" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={model.set ? "replace the current key" : "paste your API key"} />
            </label>
            {showBaseUrl && (
              <label className="grid gap-1 text-xs text-fg-secondary sm:col-span-2">
                Base URL
                <input type="url" required className="rounded border border-line bg-surface px-2 py-1.5 font-mono text-sm text-fg" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
              </label>
            )}
            {custom && (
              <label className="grid gap-1 text-xs text-fg-secondary">
                Format
                <select className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-fg" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="anthropic">Anthropic Messages</option>
                  <option value="openai">OpenAI Chat Completions</option>
                </select>
              </label>
            )}
            <div className="flex items-end gap-2 sm:col-span-2">
              <button type="submit" disabled={busy || !apiKey} className={buttonClass("primary")}>{model.source === "foldrun" ? "Save key and use it" : model.set ? "Replace key" : "Save key"}</button>
              {model.set && (
                <button type="button" disabled={busy} onClick={() => void send("DELETE")} className={buttonClass("secondary")}>Remove</button>
              )}
            </div>
          </form>
        )}
          {model.source === "foldrun" && mayEdit && (
            <button type="button" disabled={busy} onClick={() => void send("PUT", { source: "own" })} className={`mt-2 ${buttonClass("secondary")}`}>
              {model.set ? `Use my key ${model.keyHint ?? ""} instead of foldrun's models` : "Stop using foldrun's models"}
            </button>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
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
      <label className="grid gap-1 text-xs text-fg-secondary sm:w-64">
        Provider
        <select className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-fg" value={supply} onChange={(e) => setSupply(e.target.value)}>
          {fm.providers.map((x) => (
            <option key={x.name} value={x.name} disabled={!x.available}>
              {x.title}
              {x.available ? "" : " — not available"}
            </option>
          ))}
        </select>
      </label>
      {tiers.length > 0 && (
        <p className="text-xs text-fg-muted">
          <span className="mr-1.5">An agent&apos;s <code className="font-mono">model:</code></span>
          {tiers.map(([tier, m], i) => (
            <span key={tier}>
              {i > 0 && <span className="mx-1.5 text-fg-subtle">·</span>}
              <code className="font-mono">{tier}</code> → <code className="font-mono">{m}</code>
              {!priced.has(m) && <span className="ml-1 text-danger">(not priced — refused)</span>}
            </span>
          ))}
        </p>
      )}
      {prices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-fg-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Model</th>
                <th className="py-1 pr-3 font-medium">In</th>
                <th className="py-1 pr-3 font-medium">Out</th>
                <th className="py-1 pr-3 font-medium" title="cache read">Cached in</th>
                <th className="py-1 font-medium" title="cache write">Cache write</th>
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
          <p className="mt-1 text-xs text-fg-subtle">USD per million tokens of input and output. A model not listed is refused.</p>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">No models are priced for this provider yet.</p>
      )}
      <p className="text-xs text-fg-muted">
        Spent today: <span className="font-mono text-fg">{usd(fm.spentTodayUsd)}</span>
        {fm.dailyCapUsd !== null ? (
          <>
            {" "}of a <span className="font-mono text-fg">{usd(fm.dailyCapUsd)}</span> daily cap (UTC). Calls past it are refused until tomorrow — ask support to raise it.
          </>
        ) : (
          " (no daily cap)."
        )}{" "}
        Charged from your credit balance; calls stop when it reaches zero.
      </p>
      {mayEdit && (
        <div>
          <button type="button" disabled={busy || !p?.available || Boolean(fm.refused) || inUse === supply} onClick={onUse} className={buttonClass("primary")}>
            {inUse === supply ? `Running on ${p?.title ?? supply}` : `Use foldrun's ${p?.title ?? supply} models`}
          </button>
        </div>
      )}
    </div>
  );
}
