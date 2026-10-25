"use client";
// Until the address is proven, a strip — not a wall. Nothing is withheld;
// the one thing an unverified address cannot do is receive a reset link
// with confidence, and that is what the strip says.
import { useState } from "react";
import { Email } from "@/components/email";

export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      Confirm <Email value={email} className="font-medium" /> is yours — check your inbox for the link.{" "}
      {state === "sent" ? (
        <span className="text-amber-700">Sent again.</span>
      ) : state === "error" ? (
        <span className="text-red-700">{err}</span>
      ) : (
        <button
          className="underline hover:text-amber-950"
          onClick={async () => {
            const res = await fetch("/api/auth/verify/resend", { method: "POST" });
            if (res.ok) setState("sent");
            else { setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`); setState("error"); }
          }}
        >
          Resend the link
        </button>
      )}
    </div>
  );
}
