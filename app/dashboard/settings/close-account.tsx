"use client";

// Take a copy of the account, and ask to close it. Owner only: the export
// carries the ledger and the member list, and closing is the one request
// in the product its maker cannot undo.
//
// Closing is a request, not a delete: the account is suspended at once and
// the platform team settles the last invoice and any refund. The name
// typed back is the confirmation — a dialog's "OK" is too easy to press
// on the way somewhere else.

import { $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@foldrun/ui/react/input";
import { Download } from "lucide-react";
import { SettingsCard, Field, Callout } from "@foldrun/ui/react/page";
import { Button, buttonVariants } from "@foldrun/ui/react/button";

export function AccountData({ account, owner, hosted, closeRequestedAt }: { account: string; owner: boolean; hosted: boolean; closeRequestedAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!owner) {
    return (
      <SettingsCard
        id="data"
        title={$t("settings.close-account.yourData")}
        description={$t("settings.close-account.onlyTheAccountSEmail")}
      />
    );
  }

  const close = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/account/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; notified?: boolean };
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setDone(
          body.notified
            ? $t("settings.close-account.askedTheAccountIsSuspendedNow")
            : $t("settings.close-account.askedAndTheAccountIsSuspended"),
        );
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      setError($t("settings.close-account.couldNotReachThePlatform", { v0: String(err instanceof Error ? err.message : String(err)) }));
    }
    setBusy(false);
  };

  return (
    <>
      <SettingsCard
        id="data"
        title={$t("settings.close-account.takeACopy")}
        description={$t("settings.close-account.workspaceMembersAnIndexOfEvery")}
        hint={$t("settings.close-account.ownerOnly")}
        footer={
          <a href="/v1/account/export" download className={buttonVariants({ variant: "secondary" })}>
            <Download aria-hidden />
            {$t("settings.close-account.downloadExport")}
          </a>
        }
      />

      {hosted && (
        <form onSubmit={close}>
          <SettingsCard
            id="close"
            danger
            title={$t("settings.close-account.closeThisAccount")}
            description={
              closeRequestedAt
                ? $t("settings.close-account.youAskedToCloseItOn", { v0: String(closeRequestedAt.slice(0, 10)) })
                : open
                  ? $t("settings.close-account.newRunsStopAtOnceAnd")
                  : $t("settings.close-account.suspendsTheAccountAndAsksThe")
            }
            hint={open && !closeRequestedAt ? $t("settings.close-account.thisCannotBeUndoneFromHere") : undefined}
            footer={
              closeRequestedAt ? undefined : open ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                    {$t("settings.close-account.keepTheAccount")}
                  </Button>
                  <Button type="submit" variant="danger" disabled={busy || typed !== account}>
                    {busy ? $t("settings.close-account.asking") : $t("settings.close-account.suspendAndAskToClose")}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="danger-outline" onClick={() => setOpen(true)}>
                  {$t("settings.close-account.closeAccount")}
                </Button>
              )
            }
          >
            {(done || (open && !closeRequestedAt)) && (
              <div className="space-y-4">
                {done && <Callout tone="success" role="status">{done}</Callout>}
                {open && !closeRequestedAt && (
                  <>
                    <Field label={$t("settings.close-account.whyAreYouLeavingOptional")} className="max-w-md">
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
                    </Field>
                    <Field label={<>{$rich("settings.close-account.typeToConfirm", { account: account, span: (chunks) => <span className="font-mono">{chunks}</span> })}</>} className="max-w-xs">
                      <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="w-full font-mono" />
                    </Field>
                    {error && <Callout tone="danger" role="alert">{error}</Callout>}
                  </>
                )}
              </div>
            )}
          </SettingsCard>
        </form>
      )}
    </>
  );
}
