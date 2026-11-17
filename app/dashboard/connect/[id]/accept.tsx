"use client";

import { $t } from "@/i18n";
import { useState } from "react";
import Link from "@foldrun/ui/react/link";
import { Button, buttonVariants } from "@foldrun/ui/react/button";

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
      setError(data.error ?? $t("connect.id-accept.couldNotStartTheConnection"));
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Link href="/dashboard/settings?tab=secrets" className={buttonVariants({ variant: "secondary" })}>
        {$t("connect.id-accept.cancel")}
      </Link>
      <Button variant="primary" onClick={accept} disabled={busy}>
        {$t("connect.id-accept.acceptAndContinue")}
      </Button>
    </div>
  );
}
