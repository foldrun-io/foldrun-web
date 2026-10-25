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
import { buttonClass, inputClass, Card, FIELD_LABEL_CLASS } from "@/components/ui";
import { Banner } from "@/components/banner";

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
      <Card className="p-4 text-sm text-fg-tertiary">
        Only the account&apos;s owner can take a copy of its data or ask to close it — the copy includes the billing ledger and everyone&apos;s email.
      </Card>
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
    <Card className="space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-fg">Take a copy</p>
          <p className="mt-0.5 text-fg-tertiary">Workspaces, members, an index of every run, and the whole billing ledger, as one JSON file.</p>
        </div>
        <a href="/api/account/export" download className={buttonClass("secondary")}>
          Download export
        </a>
      </div>

      {hosted && (
        <div className="border-t border-line-faint pt-4">
          <p className="font-semibold text-fg">Close this account</p>
          {done && <Banner tone="ok" className="mt-2">{done}</Banner>}
          {closeRequestedAt ? (
            <p className="mt-0.5 text-fg-tertiary">You asked to close it on {closeRequestedAt.slice(0, 10)}. It is suspended while the platform team settles the last invoice; take a copy above before the data goes.</p>
          ) : open ? (
            <form onSubmit={close} className="mt-2 space-y-2">
              <p className="text-fg-tertiary">
                New runs stop at once and schedules no longer fire. Nothing is deleted yet — people can still sign in and take a copy — and the platform team will be in touch about the last invoice and any refund.
              </p>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>Why are you leaving? (optional)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass("w-full")} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>
                  Type <span className="font-mono text-gray-800">{account}</span> to confirm
                </span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputClass("w-full max-w-xs font-mono")} />
              </label>
              {error && <Banner tone="error">{error}</Banner>}
              <div className="flex items-center gap-2">
                <button disabled={busy || typed !== account} className={`${buttonClass("primary")} !bg-red-600 hover:!bg-red-700`}>
                  {busy ? "Asking…" : "Suspend and ask to close"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
                  Keep the account
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="text-fg-tertiary">Suspends the account and asks the platform team to close it. Not a delete — you can still sign in and take a copy.</p>
              <button onClick={() => setOpen(true)} className={`${buttonClass("secondary")} !text-red-700`}>
                Close account…
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
