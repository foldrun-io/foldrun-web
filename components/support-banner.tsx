"use client";

// The bar a support person sees on every page while they view a customer's
// account: whose account, that it is read-only, how long is left, and the
// way out. Drawn from the session (the layout passes it), so it is there
// exactly when the view is — and the customer never sees it, because it is
// never their session.

import { useEffect, useState } from "react";

export function SupportBanner({ account, expiresAt, reason }: { account: string; expiresAt: string; reason: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));

  const exit = async () => {
    setLeaving(true);
    try {
      // The customer app's own exit (27 Oct 2026): the console may live on
      // another host, which this page cannot write to.
      const res = await fetch("/api/support/exit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
      const data = (await res.json().catch(() => ({}))) as { next?: string };
      window.location.href = data.next ?? "/dashboard";
    } catch {
      setLeaving(false);
    }
  };

  // Lapsed: the next request finds no session, so say so instead of a 0.
  if (left === 0) {
    return (
      <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
        <span>The support view of <span className="font-semibold">{account}</span> has ended.</span>
        <button onClick={() => void exit()} className="rounded-md border border-amber-400 bg-surface px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50">Back to admin</button>
      </div>
    );
  }

  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>
        Viewing <span className="font-semibold">{account}</span> as support — read-only, ends in {left} min
        <span className="ml-2 hidden text-amber-800/80 sm:inline" title={reason}>· {reason.length > 80 ? `${reason.slice(0, 80)}…` : reason}</span>
      </span>
      <button
        onClick={() => void exit()}
        disabled={leaving}
        className="rounded-md border border-amber-400 bg-surface px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-60"
      >
        {leaving ? "Leaving…" : "Exit"}
      </button>
    </div>
  );
}
