"use client";

// Whether the account's model providers still take its keys: the last daily
// check per provider (GET /api/account/providers, read on the server for the
// first paint), and "Check now", which POSTs the same route — the moment
// after someone rotated a key and wants to know before a desk finds out.
// A check spends a real model request at each endpoint, so the button needs
// run:start, as the route does.

import { useState } from "react";
import { Chip, type Tone, SettingsCard } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import { LocalTime } from "@/components/local-time";
import { needs } from "@/components/role";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export interface ProviderConfigured {
  provider: string;
  declaredIn: string;
  model: string;
}

export interface ProviderResult {
  provider: string;
  model: string;
  declaredIn: string;
  verdict: "ok" | "credential" | "not-found" | "busy" | "unreachable" | "provider-error";
  ok: boolean;
  status: number | null;
  ms: number;
  detail: string;
}

export interface ProviderLastCheck {
  checkedAt: string;
  results: ProviderResult[];
}

const VARIANT: Record<ProviderResult["verdict"], Tone> = {
  ok: "good",
  busy: "warn",
  credential: "bad",
  "not-found": "bad",
  unreachable: "bad",
  "provider-error": "warn",
};

export function ProviderCheck({
  tenant,
  configured,
  initial,
  mayCheck,
}: {
  tenant: string;
  configured: ProviderConfigured[];
  initial: ProviderLastCheck | null;
  mayCheck: boolean;
}) {
  const [last, setLast] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/providers", {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
      });
      const data = (await res.json().catch(() => ({}))) as { lastCheck?: ProviderLastCheck | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLast(data.lastCheck ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // A provider configured but absent from the last check (added since) still
  // gets a row, marked unchecked — never a silent gap.
  const keyOf = (p: { provider: string; declaredIn: string }) => `${p.declaredIn}|${p.provider}`;
  const results = last?.results ?? [];
  const checked = new Set(results.map(keyOf));
  const unchecked = configured.filter((c) => !checked.has(keyOf(c)));

  return (
    <SettingsCard
      id="provider-check"
      title="Provider check"
      description={
        configured.length === 0
          ? "No agent here names its own provider: every model call uses the account's choice above, so there is no provider: block to check."
          : last
            ? <>Each provider your agents use is sent one tiny request a day. Last checked <LocalTime iso={last.checkedAt} />.</>
            : "Each provider your agents use is sent one tiny request a day. None has run yet."
      }
      hint={error ? <span role="alert" className="text-danger">{error}</span> : undefined}
      footer={
        configured.length > 0 && (
          <Tooltip label={mayCheck ? "Sends one small model request to each provider now" : needs("run:start")}>
            <span className="inline-flex">
              <Button variant="secondary" onClick={() => void checkNow()} disabled={busy || !mayCheck}>
                {busy ? "Checking…" : "Check now"}
              </Button>
            </span>
          </Tooltip>
        )
      }
      flush={results.length > 0 || unchecked.length > 0}
    >
      {(results.length > 0 || unchecked.length > 0) && (
        <ul className="divide-y divide-line">
          {results.map((r) => (
            <li key={`${keyOf(r)}|${r.model}`} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 px-5 py-3 sm:px-6">
              <Chip tone={VARIANT[r.verdict] ?? "default"}>{r.verdict}</Chip>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-fg">
                  {r.provider} <span className="text-fg-subtle">· {r.model}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  {r.detail}
                  {r.status !== null && <> · HTTP {r.status}</>} · {r.ms} ms
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-fg-muted">{r.declaredIn}</span>
            </li>
          ))}
          {unchecked.map((c) => (
            <li key={keyOf(c)} className="flex flex-wrap items-start gap-x-3 px-5 py-3 sm:px-6">
              <Chip>unchecked</Chip>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                {c.provider} <span className="text-fg-subtle">· {c.model}</span>
              </p>
              <span className="shrink-0 font-mono text-xs text-fg-muted">{c.declaredIn}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
