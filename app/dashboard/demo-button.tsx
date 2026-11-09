"use client";

// One click to a working pipeline. The demo teaches the grammar by being
// watched — extract, a parallel pair, an approval gate, a pretend import —
// which beats any page describing it. Hidden once the workspace exists:
// a door to something you already have is clutter.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@foldrun/ui/react/button";

/** `then`: where to go once it is made (the welcome flow's next step);
 *  without it, the demo's flows. */
export function DemoButton({
  tenant,
  exists,
  then,
  label = "Try the demo pipeline",
  variant = "secondary",
}: {
  tenant: string;
  exists: boolean;
  then?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (exists) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ demo: true }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      router.push(then ?? `/dashboard/demo-pipeline/flows${tenant !== "default" ? `?tenant=${tenant}` : ""}`);
      return;
    }
    setError(body.error ?? "could not create the demo");
    setBusy(false);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant={variant} size={variant === "primary" ? "md" : "sm"} onClick={() => void create()} disabled={busy}>
        {busy ? "Creating…" : label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
