"use client";

// The bell, beside the person at the foot of the sidebar: a door to the
// inbox, with a blue dot while something there is unread
// (GET /api/me/inbox's counts.unread). Asked once a minute and on every
// navigation, by one shared poll; hidden when there is no person to have an
// inbox (dev mode with nobody signed in).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { cn } from "./kit/cn";
import { Tooltip } from "@/components/kit/tooltip";

const EVERY_MS = 60_000;

// One poll for the page, however many places show the count.
let unread: number | null = null;
const listeners = new Set<() => void>();
let lastKey = "";
let timer: ReturnType<typeof setInterval> | null = null;
function load(tenant: string) {
  fetch("/api/me/inbox", { headers: { "x-foldrun-tenant": tenant } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { counts?: { unread?: number } } | null) => {
      unread = d?.counts ? (d.counts.unread ?? 0) : null;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useInboxUnread(): number | null {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("tenant") ?? "default";
  useEffect(() => {
    const key = `${pathname}|${t}`;
    if (key !== lastKey) {
      lastKey = key;
      load(t);
    }
    if (!timer) timer = setInterval(() => load(t), EVERY_MS);
  }, [pathname, t]);
  return useSyncExternalStore(subscribe, () => unread, () => null);
}

export function InboxLink({ className }: { className?: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const t = params.get("tenant") ?? "default";
  const n = useInboxUnread();
  if (n === null) return null;
  const on = pathname === "/dashboard/inbox";
  return (
    <Tooltip label={n ? `${n} unread in your inbox` : "Inbox"}>
    <Link
      href={`/dashboard/inbox${t !== "default" ? `?tenant=${encodeURIComponent(t)}` : ""}`}
      aria-label={n ? `Inbox, ${n} unread` : "Inbox"}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        on ? "bg-muted text-fg" : "text-fg-muted hover:bg-muted hover:text-fg",
        className,
      )}
    >
      <Bell className="size-4" strokeWidth={1.75} aria-hidden />
      {n > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-blue-600 ring-2 ring-paper" aria-hidden />}
    </Link>
    </Tooltip>
  );
}
