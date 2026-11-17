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

import { $t } from "@/i18n";
import { useState } from "react";
import { Button } from "@foldrun/ui/react/button";
import { Textarea } from "@foldrun/ui/react/input";
import { Webhook } from "lucide-react";
import { useCan, needs } from "@/components/role";
import { announceDecision } from "@/components/pending-approvals";
import { eventRelease, eventBody } from "@/components/live-run-model";
import type { StepRecord } from "@/lib/store";
import { Callout } from "@foldrun/ui/react/page";
import { Disclosure } from "@foldrun/ui/react/disclosure";
import { Tooltip } from "@foldrun/ui/react/tooltip";

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
        ...(decision === "reject" ? { reason: $t("components.event-wait-box.rejectedWhileWaitingForItsEvent") } : { payload: parsed.body }),
      }),
    });

  const curl = release
    ? `curl -X POST '${release.url}' \\\n  -H 'content-type: application/json' \\\n  -d '{"status":"done"}'`
    : `curl -X POST "$FOLDRUN_URL/api/events/<account>/${workspace}/${runId}?token=<token>" \\\n  -H 'content-type: application/json' \\\n  -d '{"status":"done"}'`;

  return (
    <Callout tone="info" className="mb-4 p-3 text-[13px] sm:p-4" bodyClassName="space-y-3">
      <span className="flex items-center gap-2 text-sm font-medium text-fg">
        <Webhook className="size-4 shrink-0 text-info" aria-hidden />
        {$t("components.event-wait-box.waitingForAnExternalEventBefore")}
      </span>
      <p className="text-fg-secondary">
        {$t("components.event-wait-box.whateverPostsThisUrlReleasesThe")}
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
            {copied ? $t("components.event-wait-box.copied") : $t("components.event-wait-box.copy")}
          </Button>
        </div>
      ) : (
        <p className="text-fg-muted">
          {$t("components.event-wait-box.theStepSTraceDoesNot")}
        </p>
      )}
      <Disclosure summaryClassName="text-[13px] font-medium text-fg-muted hover:text-fg" summary={$t("components.event-wait-box.fromATerminal")}>
        <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-surface p-2.5 font-mono text-xs text-fg-secondary">{curl}</pre>
      </Disclosure>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={$t("components.event-wait-box.payloadJsonOrPlainTextE")}
        aria-label={$t("components.event-wait-box.eventPayload")}
        className="min-h-0 font-mono text-xs"
      />
      {parsed.error && <p className="text-danger">{parsed.error}</p>}
      {error && <p className="text-danger">{error}</p>}
      <span className="flex flex-wrap items-center justify-end gap-2">
        <Tooltip label={mayRelease ? $t("components.event-wait-box.stopsWaitingTheStepFailsAnd") : needs("run:start")}>
          <span className="inline-flex">
            <Button
              size="md"
              variant="danger-outline"
              onClick={() => void viaApprove("reject")}
              disabled={busy || !mayRelease}
            >
              {$t("components.event-wait-box.reject")}
            </Button>
          </span>
        </Tooltip>
        <Tooltip label={mayRelease ? $t("components.event-wait-box.releasesTheStepWithThisPayload") : needs("run:start")}>
          <span className="inline-flex">
            <Button
              size="md"
              variant="primary"
              onClick={() => void viaApprove("approve")}
              disabled={busy || !mayRelease || !!parsed.error}
            >
              {text.trim() ? $t("components.event-wait-box.releaseWithPayload") : $t("components.event-wait-box.releaseWithEmptyPayload")}
            </Button>
          </span>
        </Tooltip>
      </span>
    </Callout>
  );
}
