"use client";

// The other direction from the rest of the Triggers page: what this
// workspace SENT. Every notify: webhook delivery — a run failed, a gate is
// waiting, a test — with each attempt's status code, time and answer, and a
// Redeliver button. A delivery that failed is retried on its own (1m, 5m,
// 30m, 2h, 6h); this is for the one that gave up, or for a receiver you just
// fixed and want to prove.

import { Fragment, useCallback, useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { Chip, EmptyState } from "@/components/kit/page";
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
      else setNote(body.ok ? `${id} redelivered — accepted (${body.attempt?.statusCode})` : `${id} redelivered — ${body.attempt?.error ?? "refused"}`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-fg-subtle">Loading…</p>;
  const { deliveries, total, endpoint } = data;

  return (
    <div className="space-y-3">
      {endpoint?.disabledAt && (
        <div role="alert" className="rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger">
          This workspace&apos;s webhook is <strong>switched off</strong> since <LocalTime iso={endpoint.disabledAt} />: {endpoint.disabledReason}. New
          notifications are recorded below but not sent. Fix the receiver, then Redeliver any delivery (or send a test from Workspace settings) — an
          accepted one switches it back on. Changing the URL in <code>notify:</code> starts it fresh.
        </div>
      )}
      {!endpoint?.disabledAt && endpoint?.failingSince && (
        <p className="text-sm text-warning">
          Every delivery has failed since <LocalTime iso={endpoint.failingSince} />. After a few days
          of that the webhook is switched off and the account owner is emailed.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="group" aria-label="Show" className="inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5">
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
            {f === "" ? "All" : f === "failed" ? "Failed" : "Retrying"}
          </button>
        ))}
        </div>
        <span className="text-[13px] text-fg-muted">{total} deliver{total === 1 ? "y" : "ies"}</span>
        {note && <span className="text-[13px] text-fg-secondary">{note}</span>}
      </div>
      {deliveries.length === 0 ? (
        <EmptyState
          compact
          icon={<Send />}
          title={filter ? "None match." : "No webhook deliveries yet"}
          description={filter ? undefined : "A workspace whose notify: is a url records every one here — failures, approval requests, tests."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-sunken text-left text-[13px] text-fg-muted">
              <tr>
                <th className="h-10 px-3 font-medium">When</th>
                <th className="h-10 px-3 font-medium">Event</th>
                <th className="h-10 px-3 font-medium">Status</th>
                <th className="h-10 px-3 font-medium">Attempts</th>
                <th className="h-10 px-3 font-medium">Last answer</th>
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
                        aria-label={`${open === d.id ? "Hide" : "Show"} the attempt log for ${d.event}`}
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
                      <Chip tone={TONE[d.status]}>{d.status === "pending" ? "retrying" : d.status}</Chip>
                      {d.status === "pending" && d.nextAttemptAt && (
                        <span className="ml-1 text-xs text-fg-subtle">next <LocalTime iso={d.nextAttemptAt} /></span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-fg-tertiary">{d.attempts}</td>
                    <td className="px-3 py-3 text-fg-tertiary">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.lastError ?? "—"}</td>
                    <td className="px-3 py-3 text-right">
                      {runs && (
                        <button
                          className={buttonClass("secondary")}
                          disabled={busy === d.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void redeliver(d.id);
                          }}
                        >
                          {busy === d.id ? "…" : "Redeliver"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr id={`delivery-${d.id}`}>
                      <td colSpan={6} className="bg-sunken px-3 py-3">
                        <p className="mb-2 font-mono text-xs text-fg-muted">
                          X-Foldrun-Delivery: {d.id} · to {d.destination ?? "?"}
                        </p>
                        <ul className="space-y-1 text-xs">
                          {d.attemptLog.map((a) => (
                            <li key={`${a.n}-${a.at}`} className="flex flex-wrap gap-x-3">
                              <span className="text-fg-subtle">#{a.n}{a.manual ? " (manual)" : ""}</span>
                              <span className="text-fg-muted"><LocalTime iso={a.at} /></span>
                              <span className={a.error ? "text-danger" : "text-success"}>{a.statusCode ? `HTTP ${a.statusCode}` : a.error}</span>
                              <span className="text-fg-subtle">{a.durationMs} ms</span>
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
          <button className={buttonClass("minimal")} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Newer</button>
          <span className="text-xs text-fg-subtle">{offset + 1}–{Math.min(total, offset + PAGE)} of {total}</span>
          <button className={buttonClass("minimal")} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older →</button>
        </div>
      )}
    </div>
  );
}
