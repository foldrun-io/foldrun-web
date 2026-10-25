"use client";

// One click to a working pipeline. The demo teaches the grammar by being
// watched — extract, a parallel pair, an approval gate, a pretend import —
// which beats any page describing it. Hidden once the workspace exists:
// a door to something you already have is clutter.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";

export function DemoButton({ tenant, exists }: { tenant: string; exists: boolean }) {
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
      router.push(`/dashboard/demo-pipeline/flows${tenant !== "default" ? `?tenant=${tenant}` : ""}`);
      return;
    }
    setError(body.error ?? "could not create the demo");
    setBusy(false);
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={() => void create()} disabled={busy} className={buttonClass("secondary")}>
        {busy ? "Creating…" : "Try the demo pipeline"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
