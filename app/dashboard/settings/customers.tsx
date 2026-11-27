"use client";

// Settings → API keys → Customers (FOL-168): an account's own end users — the
// opaque id a partner gives runs and gateway calls. The limits each one is
// held to, and the block list. Reading is everyone's; changing is an admin's
// over every workspace (the routes refuse anyone else).

import { $t, localized } from "@/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { SettingsCard, Field } from "@foldrun/ui/react/page";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { LocalTime } from "@/components/local-time";
import { WithEmails } from "@/components/email";

interface Limits {
  startsPerMinute: number;
  gatewayRpm: number;
  gatewayConcurrency: number;
  maxOpenRuns: number;
  /** Dollars a day on foldrun's models; null: no limit of its own. */
  dailyModelUsd: number | null;
}
interface Spend {
  customer: string;
  chargedUsd: number;
  todayUsd: number;
  calls: number;
}
type WholeKey = Exclude<keyof Limits, "dailyModelUsd">;
const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
interface Blocked {
  customer: string;
  by: string;
  reason: string | null;
  at: string;
}

const LABELS: { key: WholeKey; label: string; hint: string }[] = localized(() => [
  { key: "startsPerMinute", label: $t("settings.customers.runStartsAMinute"), hint: $t("settings.customers.perCustomer") },
  { key: "maxOpenRuns", label: $t("settings.customers.runsOpenAtOnce"), hint: $t("settings.customers.queuedRunningOrWaiting") },
  { key: "gatewayRpm", label: $t("settings.customers.gatewayCallsAMinute"), hint: $t("settings.customers.perCustomer") },
  { key: "gatewayConcurrency", label: $t("settings.customers.gatewayCallsAtOnce"), hint: $t("settings.customers.perCustomer") },
]);

export function CustomersCard({ tenant, limits, defaults, blocked, spend, canManage }: { tenant: string; limits: Limits; defaults: Limits; blocked: Blocked[]; spend: Spend[]; canManage: boolean }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [draft, setDraft] = useState<Record<WholeKey, string>>({
    startsPerMinute: String(limits.startsPerMinute),
    maxOpenRuns: String(limits.maxOpenRuns),
    gatewayRpm: String(limits.gatewayRpm),
    gatewayConcurrency: String(limits.gatewayConcurrency),
  });
  const [daily, setDaily] = useState(limits.dailyModelUsd === null ? "" : String(limits.dailyModelUsd));
  const [who, setWho] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const headers = { "x-foldrun-tenant": tenant, "content-type": "application/json" };

  const send = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? $t("settings.customers.refused", { status: String(res.status) }));
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = async () => {
    const patch: Record<string, number | null> = {};
    for (const { key } of LABELS) {
      const v = draft[key].trim();
      const n = v === "" ? defaults[key] : Number(v);
      patch[key] = n === defaults[key] ? null : n;
    }
    // Model spend a day: empty is no limit of its own; anything else must be
    // a real amount — a typo must never read as "take the limit away" (Codex).
    if (daily.trim() === "") patch.dailyModelUsd = null;
    else {
      const d = Number(daily);
      if (!Number.isFinite(d) || d <= 0) {
        setError($t("settings.customers.modelSpendADayIsDollars"));
        return;
      }
      patch.dailyModelUsd = d;
    }
    if (await send("/v1/customers", "PATCH", patch)) setSaid($t("settings.customers.limitsSaved"));
  };

  const block = async () => {
    const id = who.trim();
    if (!id) return;
    if (await send(`/v1/customers/${encodeURIComponent(id)}/block`, "PUT", why.trim() ? { reason: why.trim() } : {})) {
      setWho("");
      setWhy("");
      setSaid($t("settings.customers.isBlocked", { id: String(id) }));
    }
  };

  const unblock = async (id: string) => {
    const ok = await ask({ title: $t("settings.customers.unblock", { id: String(id) }), body: $t("settings.customers.itsRunsAndGatewayCallsAre"), confirmLabel: $t("settings.customers.unblock2") });
    if (ok && (await send(`/v1/customers/${encodeURIComponent(id)}/block`, "DELETE"))) setSaid($t("settings.customers.isUnblocked", { id: String(id) }));
  };

  return (
    <SettingsCard
      title={$t("settings.customers.customers")}
      description={$t("settings.customers.yourOwnUsersByTheId")}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LABELS.map(({ key, label, hint }) => (
          <Field key={key} label={label} hint={$t("settings.customers.default", { hint: String(hint), v1: String(defaults[key]) })}>
            <Input
              inputMode="numeric"
              value={draft[key]}
              disabled={!canManage || busy}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^0-9]/g, "") })}
              aria-label={label}
              className="w-full tabular-nums"
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 max-w-xs">
        <Field label={$t("settings.customers.modelSpendADay")} hint={$t("settings.customers.dollarsChargedPerCustomerUtcDay")}>
          <Input
            inputMode="decimal"
            value={daily}
            disabled={!canManage || busy}
            placeholder={$t("settings.customers.noLimit")}
            onChange={(e) => setDaily(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={$t("settings.customers.modelSpendADayInDollars")}
            className="w-full tabular-nums"
          />
        </Field>
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" disabled={busy} onClick={() => void saveLimits()}>
            {$t("settings.customers.saveLimits")}
          </Button>
        </div>
      )}

      <div className="mt-5 border-t border-line-faint pt-4">
        <h3 className="text-sm font-semibold text-fg">{$t("settings.customers.spendingMostLast7Days")}</h3>
        {spend.length === 0 ? (
          <p className="mt-1 text-[13px] text-fg-muted">{$t("settings.customers.noModelCallsNamedACustomer")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line">
            {spend.slice(0, 10).map((x) => (
              <li key={x.customer} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono text-fg">
                  <WithEmails text={x.customer} />
                </span>
                <span className="shrink-0 tabular-nums text-xs text-fg-subtle">{$t("settings.customers.calls", { calls: String(x.calls) })}</span>
                <span className="shrink-0 tabular-nums text-xs text-fg-muted">{$t("settings.customers.today", { usd: usd(x.todayUsd) })}</span>
                <span className="w-20 shrink-0 text-right font-medium tabular-nums text-fg">{usd(x.chargedUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 border-t border-line-faint pt-4">
        <h3 className="text-sm font-semibold text-fg">{$t("settings.customers.blocked")}</h3>
        {blocked.length === 0 ? (
          <p className="mt-1 text-[13px] text-fg-muted">{$t("settings.customers.noCustomerIsBlocked")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line">
            {blocked.map((b) => (
              <li key={b.customer} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <span className="font-mono text-fg">
                  <WithEmails text={b.customer} />
                </span>
                {b.reason && (
                  <span className="text-fg-muted">
                    <WithEmails text={b.reason} />
                  </span>
                )}
                <span className="ml-auto text-xs text-fg-subtle">
                  <WithEmails text={b.by} /> · <LocalTime iso={b.at} options={{ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }} />
                </span>
                {canManage && (
                  <Button variant="ghost" size="xs" disabled={busy} onClick={() => void unblock(b.customer)}>
                    {$t("settings.customers.unblock2")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder={$t("settings.customers.customerIdExample")} aria-label={$t("settings.customers.customerToBlock")} className="min-w-0 flex-1 font-mono text-xs" />
            <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={$t("settings.customers.whyOptional")} aria-label={$t("settings.customers.whyItIsBlocked")} className="min-w-0 flex-1 text-xs" />
            <Button variant="danger-outline" disabled={busy || !who.trim()} onClick={() => void block()}>
              {$t("settings.customers.block")}
            </Button>
          </div>
        )}
        {!canManage && <p className="mt-2 text-[11px] text-fg-subtle">{$t("settings.customers.anAdminWithEveryWorkspaceChanges")}</p>}
      </div>
      {said && <p className="mt-2 text-xs text-success">{said}</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {dialog}
    </SettingsCard>
  );
}
