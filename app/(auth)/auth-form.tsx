"use client";

// One form, two modes. Login and signup differ by a single field and an
// endpoint, and keeping them in one component keeps their behaviour —
// errors, redirect, disabled state — from drifting apart.

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { inputClass, buttonClass } from "@/components/ui";

const FIELD = inputClass();

export function AuthForm({ mode, invite }: { mode: "login" | "signup"; invite?: string }) {
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  // The second step: the password bought a challenge, not a session.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const body: Record<string, string> = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    if (challenge) {
      body.challenge = challenge;
      body.code = String(data.get("code") ?? "");
    }
    if (mode === "signup" && invite) body.invite = invite;
    else if (mode === "signup") body.account = String(data.get("account") ?? "");
    // The try/catch matters: a fetch that fails at the network level throws,
    // and an unhandled throw here left the button stuck on "…" forever with
    // no message — indistinguishable from a hang.
    try {
      const res = await fetch(challenge ? "/api/auth/mfa/verify" : `/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Land inside a workspace when the answer names one — the workspace is
        // the home; the account is a drawer you visit.
        const payload = (await res.json().catch(() => ({}))) as { workspace?: string; mfa?: boolean; challenge?: string };
        if (payload.mfa && payload.challenge) {
          setChallenge(payload.challenge);
          setBusy(false);
          return;
        }
        const target = payload.workspace ? `/dashboard/${payload.workspace}` : "/dashboard";
        // A full navigation, not router.push: client-side nav can wedge on a
        // stale RSC cache, and after a login the whole tree changes anyway.
        // Only a same-site absolute path is honoured: `//evil.com` and
        // `/\evil.com` start with "/" but browsers resolve them off-origin, so
        // `?next=` would be a post-login open redirect. Require a single
        // leading slash followed by a non-slash, non-backslash.
        const safeNext = /^\/[^/\\]/.test(next) ? next : target;
        window.location.assign(safeNext !== "/dashboard" ? safeNext : target);
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "something went wrong — try again");
    } catch (err) {
      setError(`could not reach the server: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {challenge && (
        // The second step replaces the form: the email and password were
        // right, and the only thing left is the code.
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-secondary">Code from your authenticator app</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123 456 — or a backup code" className={FIELD} />
          <span className="mt-1 block text-xs text-fg-muted">Lost the app? A backup code works once.</span>
        </label>
      )}
      {!challenge && mode === "signup" && !invite && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-secondary">Account name</span>
          <input
            name="account"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="lowercase letters, digits and single hyphens — like a good directory name"
            placeholder="acme"
            className={FIELD}
          />
          <span className="mt-1 block text-xs text-fg-muted">
            Lowercase, hyphens allowed. This names your workspace URLs.
          </span>
        </label>
      )}
      {!challenge && <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg-secondary">Email</span>
        <input name="email" type="email" required placeholder="you@example.com" className={FIELD} />
      </label>}
      {!challenge && <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg-secondary">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 10 : 1}
          placeholder={mode === "signup" ? "at least 10 characters" : ""}
          className={FIELD}
        />
        {mode === "login" && (
          <a href="/forgot" className="mt-1 block text-xs text-fg-muted hover:text-fg">Forgot your password?</a>
        )}
      </label>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <button
        type="submit"
        disabled={busy}
        className={buttonClass("primary", "w-full")}
      >
        {busy ? "…" : challenge ? "Verify" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
