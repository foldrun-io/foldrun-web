"use client";

// Take a copy of the account, and ask to close it. Owner only: the export
// carries the ledger and the member list, and closing is the one request
// in the product its maker cannot undo.
//
// Closing is a request, not a delete: the account is suspended at once and
// the platform team settles the last invoice and any refund. The name
// typed back is the confirmation — a dialog's "OK" is too easy to press
// on the way somewhere else.

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
        title="Your data"
        description="Only the account's owner can take a copy of its data or ask to close it — the copy includes the billing ledger and everyone's email."
      />
    );
  }

  const close = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; notified?: boolean };
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setDone(
          body.notified
            ? "Asked. The account is suspended now, and the platform team has been told — they will be in touch about the last invoice."
            : "Asked, and the account is suspended — but the notice to the platform team did not send. Please also email them.",
        );
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      setError(`could not reach the platform — ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };

  return (
    <>
      <SettingsCard
        id="data"
        title="Take a copy"
        description="Workspaces, members, an index of every run, and the whole billing ledger, as one JSON file."
        hint="Owner only."
        footer={
          <a href="/api/account/export" download className={buttonVariants({ variant: "secondary" })}>
            <Download aria-hidden />
            Download export
          </a>
        }
      />

      {hosted && (
        <form onSubmit={close}>
          <SettingsCard
            id="close"
            danger
            title="Close this account"
            description={
              closeRequestedAt
                ? `You asked to close it on ${closeRequestedAt.slice(0, 10)}. It is suspended while the platform team settles the last invoice; take a copy above before the data goes.`
                : open
                  ? "New runs stop at once and schedules no longer fire. Nothing is deleted yet — people can still sign in and take a copy — and the platform team will be in touch about the last invoice and any refund."
                  : "Suspends the account and asks the platform team to close it. Not a delete — you can still sign in and take a copy."
            }
            hint={open && !closeRequestedAt ? "This cannot be undone from here." : undefined}
            footer={
              closeRequestedAt ? undefined : open ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                    Keep the account
                  </Button>
                  <Button type="submit" variant="danger" disabled={busy || typed !== account}>
                    {busy ? "Asking…" : "Suspend and ask to close"}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="danger-outline" onClick={() => setOpen(true)}>
                  Close account…
                </Button>
              )
            }
          >
            {(done || (open && !closeRequestedAt)) && (
              <div className="space-y-4">
                {done && <Callout tone="success" role="status">{done}</Callout>}
                {open && !closeRequestedAt && (
                  <>
                    <Field label="Why are you leaving? (optional)" className="max-w-md">
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
                    </Field>
                    <Field label={<>Type <span className="font-mono">{account}</span> to confirm</>} className="max-w-xs">
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
