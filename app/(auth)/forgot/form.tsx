"use client";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

export function ForgotForm() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setMsg(null);
        const email = String(new FormData(e.currentTarget).get("email") ?? "");
        const res = await fetch("/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setMsg(j.message ?? j.error ?? `HTTP ${res.status}`);
        setBusy(false);
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg-secondary">Email</span>
        <input name="email" type="email" required autoFocus className={inputClass("w-full")} />
      </label>
      {msg && <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary">{msg}</p>}
      <button disabled={busy} className={buttonClass("primary", "w-full")}>{busy ? "…" : "Send reset link"}</button>
    </form>
  );
}
