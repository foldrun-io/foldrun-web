"use client";

// The kill switch, on the account's Settings and a workspace's: pause (no
// new run starts — a schedule, a webhook, a chained flow, a person's Run),
// optionally stopping the runs already going, and resume. server/pause.ts
// is the route side.

import { $el, $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@foldrun/ui/react/input";
import { SettingsCard, Field, Callout } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import { WithEmails } from "@/components/email";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Checkbox } from "@foldrun/ui/react/choice";

export interface PauseMarkView {
  at: string;
  by: string;
  reason?: string;
}

const since = (m: PauseMarkView) => $t("components.pause-card.utcBy", { v0: String(m.at.slice(0, 16).replace("T", " ")), by: String(m.by), v2: String(m.reason ? ` — ${m.reason}` : "") });

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
  const what = scope === "account" ? $t("components.pause-card.everyWorkspaceInThisAccount") : $t("components.pause-card.thisWorkspace");

  const send = async (method: "POST" | "DELETE") => {
    if (
      method === "POST" &&
      !(await confirm({
        title: scope === "account" ? $t("components.pause-card.pauseTheAccount") : $t("components.pause-card.pauseThisWorkspace"),
        body: $t("components.pause-card.noNewRunStartsInUntil", { what: String(what), v1: String(stop ? $t("components.pause-card.everyRunGoingNowIsStopped") : $t("components.pause-card.runsAlreadyUnderWayFinishQueued")) }),
        confirmLabel: stop ? $t("components.pause-card.pauseAndStopRuns") : $t("components.pause-card.pause"),
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
            ? await fetch("/v1/account/pause", {
                method: "POST",
                headers,
                body,
              })
            : await fetch(`/v1/workspaces/${ws}/pause`, {
                method: "POST",
                headers,
                body,
              })
          : scope === "account"
            ? await fetch("/v1/account/pause", { method: "DELETE", headers })
            : await fetch(`/v1/workspaces/${ws}/pause`, {
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
          setNote($t("components.pause-card.pausedAndRunStopped", { n: String(n), v1: n }));
          if (failed) setError($t("components.pause-card.runCouldNotBeStoppedOpen", { failed: String(failed), v1: failed }));
        }
        setReason("");
        setStop(false);
        router.refresh();
      }
    } catch (err) {
      setError($t("components.pause-card.couldNotReachThePlatform", { v0: String(err instanceof Error ? err.message : String(err)) }));
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
          {$rich("components.pause-card.theAccountIsPausedSoNothing", { withEmails: $el(<WithEmails text={since(heldByAccount)} />) })}
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
          title={$t("components.pause-card.paused")}
          description={
            <>
              {$rich("components.pause-card.noNewRunStartsInSince", { what: what, withEmails: $el(<WithEmails text={since(own)} />) })}
            </>
          }
          hint={mayManage ? $t("components.pause-card.resumingLetsSchedulesWebhooksAndRun") : $t("components.pause-card.anAdminOfThisAccountCan")}
          footer={
            mayManage && (
              <Button variant="primary" disabled={busy} onClick={() => send("DELETE")}>
                {busy ? $t("components.pause-card.resuming") : $t("components.pause-card.resume")}
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
        title={$t("components.pause-card.pauseRuns")}
        description={
          <>
            {$t("components.pause-card.stopsStartingAnythingSchedulesWebhooksChained", { what: what })}
          </>
        }
        hint={mayManage ? undefined : $t("components.pause-card.anAdminOfThisAccountCan2")}
        footer={
          mayManage && (
            <Button variant="danger" disabled={busy} onClick={() => send("POST")}>
              {busy ? $t("components.pause-card.pausing") : scope === "account" ? $t("components.pause-card.pauseTheAccount2") : $t("components.pause-card.pauseThisWorkspace2")}
            </Button>
          )
        }
      >
        {(hasNotes || mayManage) && (
          <div className="space-y-4">
            {notes}
            {mayManage && (
              <>
                <Field label={$t("components.pause-card.why")} className="max-w-md">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={$t("components.pause-card.optionalShownToEveryoneWhoOpens")} className="w-full" />
                </Field>
                <label className="flex items-center gap-2 text-sm text-fg">
                  {$rich("components.pause-card.alsoStopTheRunsGoingNow", { checkbox: $el(<Checkbox checked={stop} onCheckedChange={(checked: boolean) => setStop(checked)} />) })}
                </label>
              </>
            )}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
