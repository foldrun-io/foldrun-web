"use client";

// Your name, and your address.
//
// Two forms in one card because they are the two halves of "who is this",
// but they are NOT one form: a name saves on its own, and an address change
// asks for your password — a borrowed unlocked browser must not be able to
// re-point a login at a stranger's inbox. After a move the new address is
// unverified until it clicks the mail; the old one is told it happened.

import { $el, $rich, $t } from "@/i18n";
import { useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Email } from "@/components/email";
import { useConfirm } from "@foldrun/ui/react/confirm";

export function NameForm({ firstName, lastName }: { firstName: string | null; lastName: string | null }) {
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastName ?? "");
  const [state, setState] = useState<{ error?: string; done?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const dirty = first !== (firstName ?? "") || last !== (lastName ?? "");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({});
        setBusy(true);
        const res = await fetch("/api/auth/name", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: first, lastName: last }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        setState(res.ok ? { done: true } : { error: body.error ?? `HTTP ${res.status}` });
      }}
    >
      <div className="grid grid-cols-1 max-w-md gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block pb-1.5 text-sm font-medium text-fg">{$t("profile.identity.firstName")}</span>
          <Input value={first} onChange={(e) => setFirst(e.target.value)} className="w-full" maxLength={80} autoComplete="given-name" />
        </label>
        <label className="block">
          <span className="block pb-1.5 text-sm font-medium text-fg">{$t("profile.identity.lastName")}</span>
          <Input value={last} onChange={(e) => setLast(e.target.value)} className="w-full" maxLength={80} autoComplete="family-name" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !dirty} className={buttonVariants({ variant: "primary", size: "md" })}>{busy ? $t("profile.identity.saving") : $t("profile.identity.saveName")}</button>
        {state.done && <span className="text-xs text-success">{$t("profile.identity.saved")}</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function EmailForm({ current }: { current: string }) {
  const [email, setEmail] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ error?: string; done?: string }>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({});
        if (!(await confirm({ title: $t("profile.identity.moveYourLoginFromTo", { current: String(current), v1: String(email.trim()) }), body: $t("profile.identity.theMoveHappensWhenYouClick"), confirmLabel: $t("profile.identity.moveMyLogin"), destructive: false }))) return;
        setBusy(true);
        const res = await fetch("/api/auth/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; to?: string; pending?: boolean; verificationSent?: boolean; otherSessionsEnded?: number };
        setBusy(false);
        if (!res.ok) return setState({ error: body.error ?? `HTTP ${res.status}` });
        setPassword("");
        setEmail("");
        // Nothing has moved yet: the link mailed to the new address makes the move.
        if (body.pending) {
          return setState({ done: body.verificationSent ? $t("profile.identity.checkTheLinkInTheMail", { to: String(body.to), current: String(current) }) : $t("profile.identity.theMailToThatAddressCould") });
        }
        const ended = body.otherSessionsEnded ? $t("profile.identity.signedOut", { v0: String(body.otherSessionsEnded === 1 ? $t("profile.identity.oneOtherBrowserWas") : $t("profile.identity.otherBrowsersWere", { otherSessionsEnded: String(body.otherSessionsEnded) })) }) : "";
        setState({ done: $t("profile.identity.movedTo", { to: String(body.to), ended: String(ended), v2: String(body.verificationSent ? $t("profile.identity.checkThatInboxForTheConfirmation") : $t("profile.identity.theConfirmationMailCouldNotBe")) }) });
      }}
    >
      <p className="text-sm text-fg-tertiary">
        {$rich("profile.identity.signedInAsMovingItChanges", { email: $el(<Email value={current} className="font-medium text-fg" />) })}
      </p>
      <div className="grid grid-cols-1 max-w-md gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block pb-1.5 text-sm font-medium text-fg">{$t("profile.identity.newEmail")}</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full" autoComplete="email" required />
        </label>
        <label className="block">
          <span className="block pb-1.5 text-sm font-medium text-fg">{$t("profile.identity.yourPassword")}</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" autoComplete="current-password" required />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !email.trim() || !password} className={buttonVariants({ variant: "primary", size: "md" })}>{busy ? $t("profile.identity.moving") : $t("profile.identity.changeEmail")}</button>
        {state.done && <span className="text-xs text-success">{state.done}</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
      {confirmDialog}
    </form>
  );
}
