"use client";

// A step parked on `wait: event` — waiting for the outside world, not for a
// person — gets its own box instead of the approval one: the URL that
// releases it, the curl that does it, and a way to release it from here.
//
// "Release" POSTs the typed body to the approve route as its `payload`, so
// the step gets it exactly as the event URL would hand it over, and the
// trace says which person released it rather than "an external event".
// The event URL itself (read from the step's trace line, live-run-model.ts
// eventRelease) is still shown, with a curl, for the system outside that is
// meant to call it. Reject goes through the approve route, as for any gate.

import { useState } from "react";
import { Button } from "@/components/kit/button";
import { Textarea } from "@/components/kit/input";
import { Webhook } from "lucide-react";
import { useCan, needs } from "@/components/role";
import { announceDecision } from "@/components/pending-approvals";
import { eventRelease, eventBody } from "@/components/live-run-model";
import type { StepRecord } from "@/lib/store";

export function EventWaitBox({
  workspace,
  tenant,
  runId,
  index,
  step,
}: {
  workspace: string;
  tenant: string;
  runId: string;
  index: number;
  step: Pick<StepRecord, "waitFor" | "events">;
}) {
  const mayRelease = useCan("run:start");
  const release = eventRelease(step);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const parsed = eventBody(text);

  const send = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // The stream paints the resume; this only stops the banner asking.
      announceDecision(runId, index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const viaApprove = (decision: "approve" | "reject") =>
    send(`/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        decision,
        step: index,
        ...(decision === "reject" ? { reason: "rejected while waiting for its event" } : { payload: parsed.body }),
      }),
    });

  const curl = release
    ? `curl -X POST '${release.url}' \\\n  -H 'content-type: application/json' \\\n  -d '{"status":"done"}'`
    : `curl -X POST "$FOLDRUN_URL/api/events/<account>/${workspace}/${runId}?token=<token>" \\\n  -H 'content-type: application/json' \\\n  -d '{"status":"done"}'`;

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-info-line bg-info-soft p-3 text-[13px] sm:p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-fg">
        <Webhook className="size-4 shrink-0 text-info" aria-hidden />
        Waiting for an external event before this step runs.
      </span>
      <p className="text-fg-secondary">
        Whatever POSTs this URL releases the step, and the body reaches it as the event. Hand the URL to the system that will say so — a payment hook, a reply, a job that finishes.
      </p>
      {release ? (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-xs text-fg-secondary">POST {release.url}</code>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(release.url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : (
        <p className="text-fg-muted">
          The step&apos;s trace does not show its event URL. It carries a token the server derives from the run and is printed in the trace when the step parks; you can still release the step from here.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-[13px] font-medium text-fg-muted hover:text-fg">From a terminal</summary>
        <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-surface p-2.5 font-mono text-xs text-fg-secondary">{curl}</pre>
      </details>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder='Payload — JSON or plain text, e.g. {"status":"paid","amount":120}'
        aria-label="Event payload"
        className="min-h-0 font-mono text-xs"
      />
      {parsed.error && <p className="text-danger">{parsed.error}</p>}
      {error && <p className="text-danger">{error}</p>}
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="md"
          variant="danger-outline"
          onClick={() => void viaApprove("reject")}
          disabled={busy || !mayRelease}
          title={mayRelease ? "Stops waiting: the step fails and the run ends" : needs("run:start")}
        >
          Reject
        </Button>
        <Button
          size="md"
          variant="primary"
          onClick={() => void viaApprove("approve")}
          disabled={busy || !mayRelease || !!parsed.error}
          title={mayRelease ? "Releases the step with this payload, recorded as released by you" : needs("run:start")}
        >
          {text.trim() ? "Release with payload" : "Release with empty payload"}
        </Button>
      </span>
    </div>
  );
}
