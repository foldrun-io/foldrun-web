"use client";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

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
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg-secondary">New password</span>
        <input name="password" type="password" required minLength={10} autoFocus autoComplete="new-password" className={inputClass("w-full")} />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={buttonClass("primary", "w-full")}>{busy ? "…" : "Set password and sign in"}</button>
    </form>
  );
}
