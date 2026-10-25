"use client";

// The account's own model key (PUT/DELETE /api/account/model). On a hosted
// platform every customer account brings one; the platform's own credential
// is for the operator's accounts. The key is sent once and never shown again
// — only its last four characters.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, buttonClass } from "@/components/ui";
import type { AccountModel } from "@/server/account-model";

export function ModelKey({
  tenant,
  initial,
  presets,
  mayEdit,
}: {
  tenant: string;
  initial: AccountModel;
  presets: { name: string; title: string; needsBaseUrl: boolean }[];
  mayEdit: boolean;
}) {
  const router = useRouter();
  const [model, setModel] = useState(initial);
  const [provider, setProvider] = useState(initial.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [format, setFormat] = useState("anthropic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = presets.find((p) => p.name === provider);
  const custom = provider === "custom";
  const showBaseUrl = custom || Boolean(preset?.needsBaseUrl);

  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/model", {
        method,
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
        body: method === "PUT" ? JSON.stringify({ provider, apiKey, ...(showBaseUrl ? { baseUrl } : {}), ...(custom ? { format } : {}) }) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as AccountModel & { error?: string };
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

  const status =
    model.runsOn === "account"
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
      <p className="mt-2 text-sm text-fg-tertiary">
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
            <button type="submit" disabled={busy || !apiKey} className={buttonClass("primary")}>{model.set ? "Replace key" : "Save key"}</button>
            {model.set && (
              <button type="button" disabled={busy} onClick={() => void send("DELETE")} className={buttonClass("secondary")}>Remove</button>
            )}
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
