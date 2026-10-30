"use client";

// Your name, and your address.
//
// Two forms in one card because they are the two halves of "who is this",
// but they are NOT one form: a name saves on its own, and an address change
// asks for your password — a borrowed unlocked browser must not be able to
// re-point a login at a stranger's inbox. After a move the new address is
// unverified until it clicks the mail; the old one is told it happened.

import { useState } from "react";
import { buttonClass, inputClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { Email } from "@/components/email";

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
          <span className={FIELD_LABEL_CLASS}>First name</span>
          <input value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass("w-full")} maxLength={80} autoComplete="given-name" />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Last name</span>
          <input value={last} onChange={(e) => setLast(e.target.value)} className={inputClass("w-full")} maxLength={80} autoComplete="family-name" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !dirty} className={buttonClass("primary")}>{busy ? "Saving…" : "Save name"}</button>
        {state.done && <span className="text-xs text-emerald-600">Saved</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function EmailForm({ current }: { current: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ error?: string; done?: string }>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({});
        if (!confirm(`Move your login from ${current} to ${email.trim()}? The move happens when you click the link in the mail that address receives.`)) return;
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
          return setState({ done: body.verificationSent ? `Check ${body.to} — the link in the mail there moves your login. Until then you still sign in as ${current}.` : "The mail to that address could not be sent — try again later." });
        }
        const ended = body.otherSessionsEnded ? ` ${body.otherSessionsEnded === 1 ? "One other browser was" : `${body.otherSessionsEnded} other browsers were`} signed out.` : "";
        setState({ done: `Moved to ${body.to}.${ended} ${body.verificationSent ? "Check that inbox for the confirmation link." : "The confirmation mail could not be sent — ask your admin to mark the address verified."}` });
      }}
    >
      <p className="text-sm text-fg-tertiary">
        Signed in as <Email value={current} className="font-medium text-fg" />. Moving it changes where you sign in, where password resets go, and where run notifications land.
      </p>
      <div className="grid grid-cols-1 max-w-md gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>New email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass("w-full")} autoComplete="email" required />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Your password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass("w-full")} autoComplete="current-password" required />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !email.trim() || !password} className={buttonClass("primary")}>{busy ? "Moving…" : "Change email"}</button>
        {state.done && <span className="text-xs text-emerald-600">{state.done}</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
