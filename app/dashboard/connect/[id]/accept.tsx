"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

/** Accept: the hand-off becomes a consent bound to this browser. */
export function HandoffAccept({ id, tenant }: { id: string; tenant: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/oauth/handoff/${id}`, { method: "POST", headers: { "x-foldrun-tenant": tenant } });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && data.url) window.location.href = data.url;
    else {
      setError(data.error ?? "could not start the connection");
      setBusy(false);
    }
  }
  return (
    <div className="mt-5 flex items-center gap-3">
      <button onClick={accept} disabled={busy} className={buttonClass("primary")}>Accept and continue →</button>
      <Link href="/dashboard/settings" className={buttonClass("secondary")}>Cancel</Link>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
