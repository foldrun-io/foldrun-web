"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/kit/button";

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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Link href="/dashboard/settings?tab=secrets" className={buttonVariants({ variant: "secondary" })}>
        Cancel
      </Link>
      <Button variant="primary" onClick={accept} disabled={busy}>
        Accept and continue →
      </Button>
    </div>
  );
}
