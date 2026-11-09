"use client";

// One form, two modes. Login and signup differ by a single field and an
// endpoint, and keeping them in one component keeps their behaviour —
// errors, redirect, disabled state — from drifting apart.

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { cn } from "@foldrun/ui/react/cn";
import { Field, Callout } from "@foldrun/ui/react/page";


export function AuthForm({ mode, invite, setup }: { mode: "login" | "signup"; invite?: string; setup?: string }) {
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
    if (mode === "signup" && setup) body.setup = setup;
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
        // Someone who just made a new account starts in the welcome flow
        // (/dashboard/welcome): their model, what to start with, a first run.
        // A joiner lands in what their team already has.
        const target = mode === "signup" && !invite ? "/dashboard/welcome" : payload.workspace ? `/dashboard/${payload.workspace}` : "/dashboard";
        // A full navigation, not router.push: client-side nav can wedge on a
        // stale RSC cache, and after a login the whole tree changes anyway.
        // Only a same-site absolute path is honoured: `//evil.com` and
        // `/\evil.com` start with "/" but browsers resolve them off-origin, so
        // `?next=` would be a post-login open redirect. Require a single
        // leading slash followed by a non-slash, non-backslash — and no
        // control characters: browsers drop tab/CR/LF from a URL, so
        // "/\t/evil.com" passed the old test and landed on evil.com.
        // The default "/dashboard" means "wherever the sign-in says": the
        // account's first workspace.
        const safeNext = next === "/dashboard" ? target : sameOriginPath(next) ?? target;
        window.location.assign(safeNext);
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
        <Field label="Code from your authenticator app" hint="Lost the app? A backup code works once.">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123 456 — or a backup code" />
        </Field>
      )}
      {!challenge && mode === "signup" && !invite && (
        <Field label="Account name" hint="Lowercase, hyphens allowed. This names your workspace URLs.">
          <Tooltip label="lowercase letters, digits and single hyphens — like a good directory name">
            <Input
              name="account"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="acme"
            />
          </Tooltip>
        </Field>
      )}
      {!challenge && <Field label="Email">
        <Input name="email" type="email" required placeholder="you@example.com" />
      </Field>}
      {!challenge && <Field label="Password">
        <Input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 10 : 1}
          placeholder={mode === "signup" ? "at least 10 characters" : ""}
        />
        {mode === "login" && (
          <a href="/forgot" className="block text-xs text-fg-muted hover:text-fg">Forgot your password?</a>
        )}
      </Field>}
      {error && (
        <Callout tone="danger">{error}</Callout>
      )}
      <button
        type="submit"
        disabled={busy}
        className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
      >
        {busy ? "…" : challenge ? "Verify" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

/** `next` as a path on this origin, or null when it would leave it. */
function sameOriginPath(next: string): string | null {
  if (!/^\/[^/\\]/.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const u = new URL(next, window.location.origin);
    // The absolute URL, not its path: "/a/..//evil.com" resolves to a path
    // of "//evil.com", which a browser reads as another host.
    return u.origin === window.location.origin && !u.pathname.startsWith("//") ? u.href : null;
  } catch {
    return null;
  }
}
