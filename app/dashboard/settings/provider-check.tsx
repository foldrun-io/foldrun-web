"use client";

// Whether the account's model providers still take its keys: the last daily
// check per provider (GET /api/account/providers, read on the server for the
// first paint), and "Check now", which POSTs the same route — the moment
// after someone rotated a key and wants to know before a desk finds out.
// A check spends a real model request at each endpoint, so the button needs
// run:start, as the route does.

import { useState } from "react";
import { Badge, Card, buttonClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { needs } from "@/components/role";

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

const VARIANT: Record<ProviderResult["verdict"], "success" | "warning" | "error"> = {
  ok: "success",
  busy: "warning",
  credential: "error",
  "not-found": "error",
  unreachable: "error",
  "provider-error": "warning",
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
    <Card className="mt-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">Provider check</p>
          <p className="mt-0.5 text-sm text-fg-tertiary">
            {configured.length === 0
              ? "No agent here names its own provider, so every model call uses the platform's key — there is nothing of yours to check."
              : last
                ? <>Each provider your agents use is sent one tiny request a day. Last checked <LocalTime iso={last.checkedAt} />.</>
                : "Each provider your agents use is sent one tiny request a day. None has run yet."}
          </p>
        </div>
        {configured.length > 0 && (
          <button
            type="button"
            onClick={() => void checkNow()}
            disabled={busy || !mayCheck}
            title={mayCheck ? "Sends one small model request to each provider now" : needs("run:start")}
            className={buttonClass("secondary")}
          >
            {busy ? "Checking…" : "Check now"}
          </button>
        )}
      </div>
      {(results.length > 0 || unchecked.length > 0) && (
        <ul className="mt-3 divide-y divide-line-faint rounded-md border border-line-faint">
          {results.map((r) => (
            <li key={`${keyOf(r)}|${r.model}`} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 px-3 py-2">
              <Badge variant={VARIANT[r.verdict] ?? "default"}>{r.verdict}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-fg">
                  {r.provider} <span className="text-fg-subtle">· {r.model}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  {r.detail}
                  {r.status !== null && <> · HTTP {r.status}</>} · {r.ms} ms
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{r.declaredIn}</span>
            </li>
          ))}
          {unchecked.map((c) => (
            <li key={keyOf(c)} className="flex flex-wrap items-start gap-x-3 px-3 py-2">
              <Badge>unchecked</Badge>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                {c.provider} <span className="text-fg-subtle">· {c.model}</span>
              </p>
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{c.declaredIn}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
