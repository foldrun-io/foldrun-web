"use client";

// The other direction from the rest of the Triggers page: what this
// workspace SENT. Every notify: webhook delivery — a run failed, a gate is
// waiting, a test — with each attempt's status code, time and answer, and a
// Redeliver button. A delivery that failed is retried on its own (1m, 5m,
// 30m, 2h, 6h); this is for the one that gave up, or for a receiver you just
// fixed and want to prove.

import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge, Card, buttonClass, chipButtonClass } from "@/components/ui";
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

const VARIANT = { delivered: "success", pending: "warning", failed: "error", skipped: "default" } as const;
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

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-fg-subtle">Loading…</p>;
  const { deliveries, total, endpoint } = data;

  return (
    <div className="space-y-3">
      {endpoint?.disabledAt && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This workspace&apos;s webhook is <strong>switched off</strong> since <LocalTime iso={endpoint.disabledAt} />: {endpoint.disabledReason}. New
          notifications are recorded below but not sent. Fix the receiver, then Redeliver any delivery (or send a test from Workspace settings) — an
          accepted one switches it back on. Changing the URL in <code>notify:</code> starts it fresh.
        </Card>
      )}
      {!endpoint?.disabledAt && endpoint?.failingSince && (
        <p className="text-sm text-amber-700">
          Every delivery has failed since <LocalTime iso={endpoint.failingSince} />. After a few days
          of that the webhook is switched off and the account owner is emailed.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["", "failed", "pending"] as const).map((f) => (
          <button
            key={f || "all"}
            className={chipButtonClass(filter === f ? "bg-ink text-on-ink" : "")}
            onClick={() => {
              setFilter(f);
              setOffset(0);
            }}
          >
            {f === "" ? "All" : f === "failed" ? "Failed" : "Retrying"}
          </button>
        ))}
        <span className="text-xs text-fg-subtle">{total} deliver{total === 1 ? "y" : "ies"}</span>
        {note && <span className="text-xs text-fg-tertiary">{note}</span>}
      </div>
      {deliveries.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {filter ? "None match." : "No webhook deliveries yet. A workspace whose notify: is a url records every one here — failures, approval requests, tests."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Last answer</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {deliveries.map((d) => (
                <Fragment key={d.id}>
                  <tr className="cursor-pointer hover:bg-sunken" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted"><LocalTime iso={d.createdAt} /></td>
                    <td className="px-3 py-2 font-medium">
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
                        <span aria-hidden className="text-fg-subtle">{open === d.id ? "▾" : "▸"}</span>
                        {d.event}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={VARIANT[d.status]}>{d.status === "pending" ? "retrying" : d.status}</Badge>
                      {d.status === "pending" && d.nextAttemptAt && (
                        <span className="ml-1 text-xs text-fg-subtle">next <LocalTime iso={d.nextAttemptAt} /></span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-fg-tertiary">{d.attempts}</td>
                    <td className="px-3 py-2 text-fg-tertiary">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.lastError ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
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
                              <span className={a.error ? "text-red-700" : "text-emerald-700"}>{a.statusCode ? `HTTP ${a.statusCode}` : a.error}</span>
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
