"use client";

// The kill switch, on the account's Settings and a workspace's: pause (no
// new run starts — a schedule, a webhook, a chained flow, a person's Run),
// optionally stopping the runs already going, and resume. server/pause.ts
// is the route side.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/kit/input";
import { SettingsCard, Field, Callout } from "@/components/kit/page";
import { Button } from "@/components/kit/button";
import { WithEmails } from "@/components/email";
import { useConfirm } from "@/components/kit/confirm";
import { Checkbox } from "@/components/kit/choice";

export interface PauseMarkView {
  at: string;
  by: string;
  reason?: string;
}

const since = (m: PauseMarkView) => `${m.at.slice(0, 16).replace("T", " ")} UTC by ${m.by}${m.reason ? ` — ${m.reason}` : ""}`;

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
      const headers = {
        "content-type": "application/json",
        "x-foldrun-tenant": tenant,
      };
      const body = JSON.stringify({
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(stop ? { stop: true } : {}),
      });
      // One literal call per route and method, so the surface check
      // (scripts/surface-coverage.mjs) can see what this card reaches.
      const ws = encodeURIComponent(workspace ?? "");
      const res =
        method === "POST"
          ? scope === "account"
            ? await fetch("/api/account/pause", {
                method: "POST",
                headers,
                body,
              })
            : await fetch(`/api/workspaces/${ws}/pause`, {
                method: "POST",
                headers,
                body,
              })
          : scope === "account"
            ? await fetch("/api/account/pause", { method: "DELETE", headers })
            : await fetch(`/api/workspaces/${ws}/pause`, {
                method: "DELETE",
                headers,
              });
      const answer = (await res.json().catch(() => ({}))) as {
        error?: string;
        stopped?: string[];
        failed?: unknown[];
      };
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

  const notes = (
    <>
      {note && (
        <Callout tone="success" role="status">
          {note}
        </Callout>
      )}
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      {heldByAccount && (
        <Callout tone="warning">
          The account is paused, so nothing here runs either — <WithEmails text={since(heldByAccount)} />. Resume it in the account&apos;s Settings.
        </Callout>
      )}
    </>
  );

  const hasNotes = Boolean(note || error || heldByAccount);
  if (own) {
    return (
      <>
        {dialog}
        <SettingsCard
          id="pause"
          title="Paused"
          description={
            <>
              No new run starts in {what}. Since <WithEmails text={since(own)} />.
            </>
          }
          hint={mayManage ? "Resuming lets schedules, webhooks and Run start again." : "An admin of this account can resume it."}
          footer={
            mayManage && (
              <Button variant="primary" disabled={busy} onClick={() => send("DELETE")}>
                {busy ? "Resuming…" : "Resume"}
              </Button>
            )
          }
        >
          {hasNotes && <div className="space-y-2">{notes}</div>}
        </SettingsCard>
      </>
    );
  }

  return (
    <>
      {dialog}
      <SettingsCard
        id="pause"
        danger
        title="Pause runs"
        description={
          <>
            Stops {what} starting anything — schedules, webhooks, chained flows and the Run button — until someone resumes it. A fire while paused is logged on Triggers as &ldquo;paused by a
            person&rdquo; and is not run later.
          </>
        }
        hint={mayManage ? undefined : "An admin of this account can pause it."}
        footer={
          mayManage && (
            <Button variant="danger" disabled={busy} onClick={() => send("POST")}>
              {busy ? "Pausing…" : scope === "account" ? "Pause the account" : "Pause this workspace"}
            </Button>
          )
        }
      >
        {(hasNotes || mayManage) && (
          <div className="space-y-4">
            {notes}
            {mayManage && (
              <>
                <Field label="Why" className="max-w-md">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Optional — shown to everyone who opens it" className="w-full" />
                </Field>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Checkbox checked={stop} onCheckedChange={(checked: boolean) => setStop(checked)} />
                  Also stop the runs going now
                </label>
              </>
            )}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
