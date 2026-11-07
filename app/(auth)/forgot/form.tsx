"use client";
import { useState } from "react";
import { buttonVariants } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { cn } from "@/components/kit/cn";
import { Field } from "@/components/kit/page";

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
      <Field label="Email">
        <Input name="email" type="email" required autoFocus className="w-full" />
      </Field>
      {msg && <p className="rounded-md border border-line bg-sunken px-3 py-2 text-sm text-fg-secondary">{msg}</p>}
      <button disabled={busy} className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}>{busy ? "…" : "Send reset link"}</button>
    </form>
  );
}
