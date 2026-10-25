"use client";

// Test one hook on one event: what a step would hear back. On an install
// that isolates runs the server refuses and says where to test instead —
// a hook is the customer's code and only runs inside a step's sandbox there.

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

interface Answer {
  ok: boolean;
  decision?: "allow" | "deny";
  reason?: string;
  input?: Record<string, unknown>;
  context?: string;
  reply?: string;
  note?: string;
  failure?: string;
  ms: number;
}

type Result =
  | { kind: "answer"; answer: Answer }
  | { kind: "refused"; summary: string; detail: string }
  | { kind: "error"; message: string };

export function HookTest({ workspace, tenant, hook, sample }: { workspace: string; tenant: string; hook: string; sample: string }) {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState(sample);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event);
    } catch {
      setResult({ kind: "error", message: "the event is not JSON" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/hooks/${encodeURIComponent(hook)}/test`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ event: parsed }),
      });
      const data = await res.json();
      if (!res.ok) setResult({ kind: "error", message: data.error ?? `${res.status}` });
      else if (data.testable === false) setResult({ kind: "refused", summary: data.summary, detail: data.detail });
      else setResult({ kind: "answer", answer: data as Answer });
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-fg-muted hover:text-fg">
        Test
      </button>
    );
  }
  const a = result?.kind === "answer" ? result.answer : null;
  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={event}
        onChange={(e) => setEvent(e.target.value)}
        rows={4}
        spellCheck={false}
        aria-label={`event for ${hook}`}
        className={inputClass("w-full font-mono text-xs")}
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className={buttonClass("secondary")}>
          {busy ? "Running…" : "Run it"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setResult(null); }} className="text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      </div>
      {result?.kind === "error" && <p className="text-xs text-red-700">{result.message}</p>}
      {result?.kind === "refused" && (
        <div className="rounded-md border border-line bg-sunken p-2 text-xs text-fg-secondary">
          <p className="font-medium">{result.summary}</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-fg-muted">{result.detail}</pre>
        </div>
      )}
      {a && (
        <div className={`rounded-md border p-2 text-xs ${!a.ok ? "border-red-200 bg-red-50 text-red-700" : a.decision === "deny" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-line bg-sunken text-fg-secondary"}`}>
          <p className="font-medium">
            {!a.ok ? `failed: ${a.failure}` : a.decision === "deny" ? "deny" : a.decision === "allow" ? "allow" : "ok"}
            <span className="ml-2 font-normal text-fg-muted">{a.ms}ms</span>
          </p>
          {a.reason && <p>reason: {a.reason}</p>}
          {a.input && <p className="break-all font-mono">input: {JSON.stringify(a.input)}</p>}
          {a.context && <p>context: {a.context}</p>}
          {a.reply !== undefined && <p>reply: {a.reply}</p>}
          {a.note && <p>note: {a.note}</p>}
        </div>
      )}
    </div>
  );
}
