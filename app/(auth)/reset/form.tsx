"use client";
import { useState } from "react";
import { buttonVariants } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { cn } from "@/components/kit/cn";
import { Field, Callout } from "@/components/kit/page";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        const password = String(new FormData(e.currentTarget).get("password") ?? "");
        const res = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
        if (res.ok) {
          // With a second factor the reset signs nobody in: the login asks for the code.
          const j = (await res.json().catch(() => ({}))) as { signIn?: boolean };
          window.location.assign(j.signIn ? "/login?reset=1" : "/dashboard");
          return;
        }
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        setBusy(false);
      }}
    >
      <Field label="New password">
        <Input name="password" type="password" required minLength={10} autoFocus autoComplete="new-password" className="w-full" />
      </Field>
      {error && <Callout tone="danger">{error}</Callout>}
      <button disabled={busy} className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}>{busy ? "…" : "Set password and sign in"}</button>
    </form>
  );
}
