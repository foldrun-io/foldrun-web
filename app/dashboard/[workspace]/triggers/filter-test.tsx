"use client";

// One flow's `filter:`, and a box to try a delivery against it. Paste the
// JSON a sender would post (or the email, chained run or storage event the
// trigger delivers) and the deployed filter answers: would it start a run,
// and if not, which condition held it back. Nothing is started or recorded
// (POST …/flows/<flow>/filter).

import { useState } from "react";
import { buttonClass, Card, FIELD_LABEL_CLASS } from "@/components/ui";
import { WithEmails } from "@/components/email";

/** What the trigger delivers, as a starting point for the box. */
const SAMPLE: Record<string, unknown> = {
  webhook: { action: "opened", sender: { type: "User" } },
  email: { from: "ana@example.com", to: "desk@example.com", subject: "Invoice 42", text: "…" },
  flow: { run: "run-abc", flow: "research", status: "completed", ending: "completed", verdict: "GOOD", summary: "GOOD — …" },
  storage: { by: "upload", paths: ["leads/2026-10-24.csv"] },
};

export function FilterTest({
  workspace,
  tenant,
  flow,
  trigger,
  filter,
}: {
  workspace: string;
  /** The account the page shows — sent, so the test reads that account's flow. */
  tenant: string;
  flow: string;
  trigger: string;
  filter: unknown;
}) {
  const [payload, setPayload] = useState(JSON.stringify(SAMPLE[trigger] ?? {}, null, 2));
  const [answer, setAnswer] = useState<{ match: boolean; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Sent as text: the route reads it as a webhook body would, and a body
      // that is not JSON matches no filter — which is the answer to show.
      parsed = payload;
    }
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flow)}/filter`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ payload: parsed }),
      });
      const body = (await res.json().catch(() => ({}))) as { match?: boolean; reason?: string; error?: string };
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else setAnswer({ match: !!body.match, reason: body.reason ?? "" });
    } catch (err) {
      setError(`could not reach the platform — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-fg">
          {flow} <span className="font-normal text-fg-muted">· trigger: {trigger}</span>
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <span className={FIELD_LABEL_CLASS}>filter:</span>
          <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-sunken p-2 font-mono text-xs text-fg-secondary"><WithEmails text={JSON.stringify(filter, null, 2)} /></pre>
        </div>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>A delivery to test</span>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            rows={8}
            className="mt-1 w-full rounded-md border border-line-strong bg-surface p-2 font-mono text-xs text-fg-secondary focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-line"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button onClick={test} disabled={busy} className={buttonClass("secondary")}>
          {busy ? "Testing…" : "Test filter"}
        </button>
        {answer && (
          <p className={`text-sm ${answer.match ? "text-emerald-700" : "text-amber-700"}`}>
            {answer.match ? "Would start a run" : "Would not start a run"} — <WithEmails text={answer.reason} />
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Card>
  );
}
