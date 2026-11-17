"use client";

// The other direction from the rest of the Triggers page: what this
// workspace SENT. Every notify: webhook delivery — a run failed, a gate is
// waiting, a test — with each attempt's status code, time and answer, and a
// Redeliver button. A delivery that failed is retried on its own (1m, 5m,
// 30m, 2h, 6h); this is for the one that gave up, or for a receiver you just
// fixed and want to prove.

import { DELIVERY_STATUS_LABEL, labelOf } from "@/components/value-labels";
import { $el, $rich, $t } from "@/i18n";
import { Fragment, useCallback, useEffect, useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Chip, EmptyState, Callout } from "@foldrun/ui/react/page";
import { ChevronDown, ChevronRight, Send } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { useCan } from "@/components/role";

interface Attempt {
  n: number;
  at: string;
  statusCode: number | null;
  durationMs: number;
  response: string | null;
  error: string | null;
  manual?: boolean;
}

interface Delivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed" | "skipped";
  destination: string | null;
  attempts: number;
  attemptLog: Attempt[];
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

interface Endpoint {
  failingSince: string | null;
  lastSuccessAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
}

const TONE = { delivered: "good", pending: "warn", failed: "bad", skipped: "default" } as const;
const PAGE = 25;

export function WebhookDeliveries({ workspace }: { workspace: string }) {
  const [filter, setFilter] = useState<"" | "failed" | "pending">("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ deliveries: Delivery[]; total: number; endpoint: Endpoint | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runs = useCan("run:start");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter) q.set("status", filter);
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/notify/deliveries?${q}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
    else {
      setError(null);
      setData(body);
    }
  }, [workspace, filter, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const redeliver = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/notify/deliveries/${encodeURIComponent(id)}/redeliver`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setNote(body.error ?? `HTTP ${res.status}`);
      else setNote(body.ok ? $t("workspace.triggers-webhook-deliveries.redeliveredAccepted", { id: String(id), statusCode: String(body.attempt?.statusCode) }) : $t("workspace.triggers-webhook-deliveries.redelivered", { id: String(id), v1: String(body.attempt?.error ?? $t("workspace.triggers-webhook-deliveries.refused")) }));
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-fg-subtle">{$t("workspace.triggers-webhook-deliveries.loading")}</p>;
  const { deliveries, total, endpoint } = data;

  return (
    <div className="space-y-3">
      {endpoint?.disabledAt && (
        <Callout tone="danger" className="p-4 text-sm" role="alert">
          {$rich("workspace.triggers-webhook-deliveries.thisTermSWebhookIsSwitched", { strong: (chunks) => <strong>{chunks}</strong>, localTime: $el(<LocalTime iso={endpoint.disabledAt} />), disabledReason: endpoint.disabledReason ?? "", code: (chunks) => <code>{chunks}</code> })}
        </Callout>
      )}
      {!endpoint?.disabledAt && endpoint?.failingSince && (
        <p className="text-sm text-warning">
          {$rich("workspace.triggers-webhook-deliveries.everyDeliveryHasFailedSinceAfter", { localTime: $el(<LocalTime iso={endpoint.failingSince} />) })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="group" aria-label={$t("workspace.triggers-webhook-deliveries.show")} className="inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5">
        {(["", "failed", "pending"] as const).map((f) => (
          <button
            key={f || "all"}
            type="button"
            aria-pressed={filter === f}
            className={`flex h-full items-center rounded-sm px-2.5 text-[13px] font-medium transition-colors ${filter === f ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-fg-muted hover:text-fg"}`}
            onClick={() => {
              setFilter(f);
              setOffset(0);
            }}
          >
            {f === "" ? $t("workspace.triggers-webhook-deliveries.all") : f === "failed" ? $t("workspace.triggers-webhook-deliveries.failed") : $t("workspace.triggers-webhook-deliveries.retrying")}
          </button>
        ))}
        </div>
        <span className="text-[13px] text-fg-muted">{$t("workspace.triggers-webhook-deliveries.deliver", { total: total })}</span>
        {note && <span className="text-[13px] text-fg-secondary">{note}</span>}
      </div>
      {deliveries.length === 0 ? (
        <EmptyState
          compact
          icon={<Send />}
          title={filter ? $t("workspace.triggers-webhook-deliveries.noneMatch") : $t("workspace.triggers-webhook-deliveries.noWebhookDeliveriesYet")}
          description={filter ? undefined : $t("workspace.triggers-webhook-deliveries.aWorkspaceWhoseNotifyIsA")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-sunken text-left text-[13px] text-fg-muted">
              <tr>
                <th className="h-10 px-3 font-medium">{$t("workspace.triggers-webhook-deliveries.when")}</th>
                <th className="h-10 px-3 font-medium">{$t("workspace.triggers-webhook-deliveries.event")}</th>
                <th className="h-10 px-3 font-medium">{$t("workspace.triggers-webhook-deliveries.status")}</th>
                <th className="h-10 px-3 font-medium">{$t("workspace.triggers-webhook-deliveries.attempts")}</th>
                <th className="h-10 px-3 font-medium">{$t("workspace.triggers-webhook-deliveries.lastAnswer")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deliveries.map((d) => (
                <Fragment key={d.id}>
                  <tr className="cursor-pointer hover:bg-sunken" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <td className="whitespace-nowrap px-3 py-3 text-fg-muted"><LocalTime iso={d.createdAt} /></td>
                    <td className="px-3 py-3 font-medium">
                      {/* The row opens on a click anywhere; this is the control a keyboard and a screen reader reach. */}
                      <button
                        type="button"
                        aria-expanded={open === d.id}
                        aria-controls={`delivery-${d.id}`}
                        aria-label={$t("workspace.triggers-webhook-deliveries.theAttemptLogFor", { v0: String(open === d.id ? $t("workspace.triggers-webhook-deliveries.hide") : $t("workspace.triggers-webhook-deliveries.show")), event: String(d.event) })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(open === d.id ? null : d.id);
                        }}
                        className="inline-flex items-center gap-1 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {open === d.id ? <ChevronDown aria-hidden className="size-4 text-fg-subtle" /> : <ChevronRight aria-hidden className="size-4 text-fg-subtle" />}
                        {d.event}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <Chip tone={TONE[d.status]}>{labelOf(DELIVERY_STATUS_LABEL, d.status === "pending" ? "retrying" : d.status)}</Chip>
                      {d.status === "pending" && d.nextAttemptAt && (
                        <span className="ml-1 text-xs text-fg-subtle">{$rich("workspace.triggers-webhook-deliveries.next", { localTime: $el(<LocalTime iso={d.nextAttemptAt} />) })}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-fg-tertiary">{d.attempts}</td>
                    <td className="px-3 py-3 text-fg-tertiary">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.lastError ?? "—"}</td>
                    <td className="px-3 py-3 text-right">
                      {runs && (
                        <button
                          className={buttonVariants({ variant: "secondary" })}
                          disabled={busy === d.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void redeliver(d.id);
                          }}
                        >
                          {busy === d.id ? "…" : $t("workspace.triggers-webhook-deliveries.redeliver")}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr id={`delivery-${d.id}`}>
                      <td colSpan={6} className="bg-sunken px-3 py-3">
                        <p className="mb-2 font-mono text-xs text-fg-muted">
                          {$t("workspace.triggers-webhook-deliveries.xFoldrunDeliveryTo", { id: d.id, destination: d.destination ?? "?" })}
                        </p>
                        <ul className="space-y-1 text-xs">
                          {d.attemptLog.map((a) => (
                            <li key={`${a.n}-${a.at}`} className="flex flex-wrap gap-x-3">
                              <span className="text-fg-subtle">#{a.n}{a.manual ? $t("workspace.triggers-webhook-deliveries.manualMark") : ""}</span>
                              <span className="text-fg-muted"><LocalTime iso={a.at} /></span>
                              <span className={a.error ? "text-danger" : "text-success"}>{a.statusCode ? `HTTP ${a.statusCode}` : a.error}</span>
                              <span className="text-fg-subtle">{$t("workspace.triggers-webhook-deliveries.ms", { durationMs: String(a.durationMs) })}</span>
                              {a.response && <code className="max-w-full truncate text-fg-tertiary">{a.response}</code>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <div className="flex items-center gap-2 text-sm">
          <button className={buttonVariants({ variant: "ghost" })} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{$t("workspace.triggers-webhook-deliveries.newer")}</button>
          <span className="text-xs text-fg-subtle">{$t("workspace.triggers-webhook-deliveries.of", { offset: String(offset + 1), total: String(Math.min(total, offset + PAGE)), total2: String(total) })}</span>
          <button className={buttonVariants({ variant: "ghost" })} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{$t("workspace.triggers-webhook-deliveries.older")}</button>
        </div>
      )}
    </div>
  );
}
