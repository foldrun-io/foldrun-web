"use client";

// The inbox door in the top bar, with how many items assigned to you or on
// runs you started you have not read (GET /api/me/inbox's counts.unread).
// Asked once a minute and on every navigation; hidden when there is no
// person to have an inbox (dev mode with nobody signed in).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 60_000;

export function InboxLink({ tenant }: { tenant: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("tenant") ?? tenant;
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/me/inbox", { headers: { "x-foldrun-tenant": t } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { counts?: { unread?: number } } | null) => {
          if (alive) setUnread(d?.counts ? (d.counts.unread ?? 0) : null);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname, t]);

  if (unread === null) return null;
  const on = pathname === "/dashboard/inbox";
  return (
    <Link
      href={`/dashboard/inbox${t !== "default" ? `?tenant=${encodeURIComponent(t)}` : ""}`}
      title={unread ? `${unread} unread in your inbox` : "Your inbox"}
      aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
      className={`relative flex h-8 items-center gap-1.5 rounded-md px-2 text-sm ${on ? "bg-accent-soft text-accent" : "text-fg-tertiary hover:bg-muted-strong/40 hover:text-fg"}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      <span className="max-sm:hidden">Inbox</span>
      {unread > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">{unread > 99 ? "99+" : unread}</span>
      )}
    </Link>
  );
}
