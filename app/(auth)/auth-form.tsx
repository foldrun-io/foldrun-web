"use client";

// One form, two modes. Login and signup differ by a single field and an
// endpoint, and keeping them in one component keeps their behaviour —
// errors, redirect, disabled state — from drifting apart.

import { $t } from "@/i18n";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { cn } from "@foldrun/ui/react/cn";
import { Field, Callout } from "@foldrun/ui/react/page";


export function AuthForm({ mode, invite, setup, link, codeSignIn }: {
  mode: "login" | "signup";
  /** Offer "email me a code" beside the password (FOL-185); set by the sign-in page when the install can send one. */
  codeSignIn?: boolean;
  invite?: string;
  setup?: string;
  /** A sign-up link the platform mailed: its token, and the one address it is for. */
  link?: { token: string; email: string };
}) {
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  // The second step: the password bought a challenge, not a session.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Signing in with an emailed code instead of a password: first the address,
  // then the code that came. The code replaces the password only; a second
  // factor, when one is on, still follows (the `challenge` step above).
  const [viaCode, setViaCode] = useState(false);
  const [codeAsked, setCodeAsked] = useState(false);
  const [canResend, setCanResend] = useState(false);

  async function askCode(email: string) {
    const res = await fetch("/api/auth/login/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "something went wrong — try again");
    }
    setCodeAsked(true);
    setCanResend(false);
    setTimeout(() => setCanResend(true), 30_000);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    if (viaCode && !codeAsked && !challenge) {
      try {
        await askCode(String(data.get("email") ?? ""));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
      return;
    }
    const body: Record<string, string> = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    if (viaCode && codeAsked && !challenge) {
      delete body.password;
      body.code = String(data.get("code") ?? "");
    }
    if (challenge) {
      body.challenge = challenge;
      body.code = String(data.get("code") ?? "");
    }
    if (mode === "signup" && invite) body.invite = invite;
    else if (mode === "signup") body.account = String(data.get("account") ?? "");
    if (mode === "signup" && setup) body.setup = setup;
    if (mode === "signup" && link) body.link = link.token;
    // The try/catch matters: a fetch that fails at the network level throws,
    // and an unhandled throw here left the button stuck on "…" forever with
    // no message — indistinguishable from a hang.
    try {
      const res = await fetch(challenge ? "/api/auth/mfa/verify" : viaCode ? "/api/auth/login/code/verify" : `/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Land inside a workspace when the answer names one — the workspace is
        // the home; the account is a drawer you visit.
        const payload = (await res.json().catch(() => ({}))) as { workspace?: string; mfa?: boolean; challenge?: string; next?: string };
        if (payload.mfa && payload.challenge) {
          setChallenge(payload.challenge);
          setBusy(false);
          return;
        }
        // Someone who just made a new account starts in the welcome flow
        // (/dashboard/welcome): their model, what to start with, a first run.
        // A joiner lands in what their team already has.
        // A sign-up link may name where to go next — the page that asked for
        // it (foldrun.ir's payment form). It came from the server, out of the
        // signed link, and is only ever https.
        if (mode === "signup" && link && typeof payload.next === "string" && payload.next.startsWith("https://")) {
          window.location.assign(payload.next);
          return;
        }
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
        <Field label="Account name" hint={$t("auth.auth-form.lowercaseHyphensAllowedThisNamesYour")}>
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
        <Input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          {...(link ? { defaultValue: link.email, readOnly: true, "aria-readonly": true } : {})}
        />
      </Field>}
      {!challenge && !viaCode && <Field label="Password">
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
      {!challenge && viaCode && codeAsked && (
        <>
          <Callout tone="info">If that address can sign in with a code, one is on its way. It works for 10 minutes, once, in this browser.</Callout>
          <Field label="Code from your email">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9 ]{6,7}" placeholder="123 456" />
          </Field>
        </>
      )}
      {error && (
        <Callout tone="danger">{error}</Callout>
      )}
      {mode === "login" && codeSignIn && !challenge && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <button
            type="button"
            className="hover:text-fg"
            onClick={() => {
              setViaCode(!viaCode);
              setCodeAsked(false);
              setError(null);
            }}
          >
            {viaCode ? "Use a password instead" : "Email me a code instead"}
          </button>
          {viaCode && codeAsked && (
            <button
              type="button"
              className="hover:text-fg disabled:opacity-50"
              disabled={!canResend || busy}
              onClick={async (e) => {
                const form = e.currentTarget.form;
                setError(null);
                try {
                  await askCode(String(new FormData(form ?? undefined).get("email") ?? ""));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Send a new code
            </button>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
      >
        {busy ? "…" : challenge ? "Verify" : viaCode && !codeAsked ? "Email me a code" : mode === "signup" ? "Create account" : "Sign in"}
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
