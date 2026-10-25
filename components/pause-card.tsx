"use client";

// The kill switch, on the account's Settings and a workspace's: pause (no
// new run starts — a schedule, a webhook, a chained flow, a person's Run),
// optionally stopping the runs already going, and resume. server/pause.ts
// is the route side.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, Card, FIELD_LABEL_CLASS } from "@/components/ui";
import { Banner } from "@/components/banner";
import { WithEmails } from "@/components/email";
import { useConfirm } from "@/components/confirm";

export interface PauseMarkView {
  at: string;
  by: string;
  reason?: string;
}

const since = (m: PauseMarkView) =>
  `${m.at.slice(0, 16).replace("T", " ")} UTC by ${m.by}${m.reason ? ` — ${m.reason}` : ""}`;

export function PauseCard({
  workspace,
  tenant,
  scope,
  own,
  heldByAccount,
  mayManage,
}: {
  /** The workspace whose switch this is; absent on the account's page. */
  workspace?: string;
  tenant: string;
  scope: "account" | "workspace";
  /** This scope's own pause, or null. */
  own: PauseMarkView | null;
  /** A workspace's page: the account's pause, which holds here too and
   *  only the account's resume lifts. */
  heldByAccount?: PauseMarkView | null;
  mayManage: boolean;
}) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [reason, setReason] = useState("");
  const [stop, setStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const what = scope === "account" ? "every workspace in this account" : "this workspace";

  const send = async (method: "POST" | "DELETE") => {
    if (
      method === "POST" &&
      !(await confirm({
        title: scope === "account" ? "Pause the account?" : "Pause this workspace?",
        body: `No new run starts in ${what} until someone resumes it.${stop ? " Every run going now is stopped, and a stopped run cannot be picked up again." : " Runs already under way finish; queued ones wait for the resume."}`,
        confirmLabel: stop ? "Pause and stop runs" : "Pause",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };
      const body = JSON.stringify({ ...(reason.trim() ? { reason: reason.trim() } : {}), ...(stop ? { stop: true } : {}) });
      // One literal call per route and method, so the surface check
      // (scripts/surface-coverage.mjs) can see what this card reaches.
      const ws = encodeURIComponent(workspace ?? "");
      const res =
        method === "POST"
          ? scope === "account"
            ? await fetch("/api/account/pause", { method: "POST", headers, body })
            : await fetch(`/api/workspaces/${ws}/pause`, { method: "POST", headers, body })
          : scope === "account"
            ? await fetch("/api/account/pause", { method: "DELETE", headers })
            : await fetch(`/api/workspaces/${ws}/pause`, { method: "DELETE", headers });
      const answer = (await res.json().catch(() => ({}))) as { error?: string; stopped?: string[]; failed?: unknown[] };
      if (!res.ok) setError(answer.error ?? `HTTP ${res.status}`);
      else {
        if (method === "POST" && stop) {
          const n = answer.stopped?.length ?? 0;
          const failed = answer.failed?.length ?? 0;
          setNote(`Paused, and ${n} run${n === 1 ? "" : "s"} stopped.`);
          if (failed) setError(`${failed} run${failed === 1 ? "" : "s"} could not be stopped — open Runs and stop ${failed === 1 ? "it" : "them"} there.`);
        }
        setReason("");
        setStop(false);
        router.refresh();
      }
    } catch (err) {
      setError(`could not reach the platform — ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };

  return (
    <Card className="space-y-3 p-4 text-sm">
      {dialog}
      {note && <Banner tone="ok">{note}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {heldByAccount && (
        <Banner tone="warn">
          The account is paused, so nothing here runs either — <WithEmails text={since(heldByAccount)} />. Resume it in the account&apos;s Settings.
        </Banner>
      )}
      {own ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-fg">Paused</p>
            <p className="mt-0.5 text-fg-tertiary">
              No new run starts in {what}. Since <WithEmails text={since(own)} />.
            </p>
          </div>
          {mayManage && (
            <button disabled={busy} onClick={() => send("DELETE")} className={buttonClass("primary")}>
              {busy ? "Resuming…" : "Resume"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="font-semibold text-fg">Pause runs</p>
            <p className="mt-0.5 text-fg-tertiary">
              Stops {what} starting anything — schedules, webhooks, chained flows and the Run button — until someone resumes it. A fire while paused is logged on Triggers as &ldquo;paused by a person&rdquo; and is not run later.
            </p>
          </div>
          {mayManage ? (
            <>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>Why (optional — shown to everyone who opens it)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass("w-full")} />
              </label>
              <label className="flex items-center gap-2 text-fg-secondary">
                <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} />
                Also stop the runs going now
              </label>
              <button disabled={busy} onClick={() => send("POST")} className={buttonClass("destructive")}>
                {busy ? "Pausing…" : scope === "account" ? "Pause the account" : "Pause this workspace"}
              </button>
            </>
          ) : (
            <p className="text-fg-tertiary">An admin of this account can pause it.</p>
          )}
        </div>
      )}
    </Card>
  );
}
