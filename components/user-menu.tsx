"use client";

// The profile menu, top right — the account's front door, the way every SaaS
// puts the person-and-money pages behind the avatar rather than in the work
// nav. The sidebar is for the workspace you are in; this is for who you are:
// account overview, usage, wallet, help, settings, sign out.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { useHosted } from "./edition";

export function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tenantParam = params.get("tenant") ?? "default";
  const qs = tenantParam !== "default" ? `?tenant=${tenantParam}` : "";

  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<{ email?: string; tenant?: string; avatar?: string | null; superAdmin?: boolean; adminUrl?: string }>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { user?: { email?: string; tenant?: string; avatar?: string | null; superAdmin?: boolean; adminUrl?: string } }) => setWho(d.user ?? {}))
      .catch(() => {});
  }, []);

  // Same close discipline as the workspace switcher: a click anywhere else,
  // or Escape, puts the menu away. Capture phase so a link inside still
  // navigates rather than racing the close.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer as EventListener, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer as EventListener, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on navigation — the menu is a launcher, not a place.
  useEffect(() => setOpen(false), [pathname]);

  const name = who.tenant ?? tenantParam;
  const hosted = useHosted();

  const items = [
    // No "Account" door here: the workspace switcher's footer already
    // opens the account (its workspaces and shared shelves), and two links
    // to one page read as two pages until you click both.
    { name: "Profile", href: `/dashboard/profile${qs}` },
    // One door for money. Hosted, that is the Billing section — balance,
    // usage, statement, invoices, payment, limits — under one set of tabs.
    // Self-hosted, there is no wallet and the only money page is Usage: a
    // self-hoster pays their own model bill and should still see what a
    // run cost.
    hosted ? { name: "Billing", href: `/dashboard/billing${qs}` } : { name: "Usage", href: `/dashboard/usage${qs}` },
    // The way into the super admin console, for the one person it
    // exists for. Last, and separated below, because it is not part of
    // this account — it is the platform looking at every account.
    ...(who.superAdmin ? [{ name: "Super admin", href: who.adminUrl ?? "/admin" }] : []),
    // Docs before Help: docs is where someone who has not started goes, help is
    // the reference you open mid-edit. The order is the order you need them in.
    { name: "Docs", href: `/dashboard/docs${qs}` },
    { name: "Help", href: `/dashboard/help${qs}` },
    // The platform's own status page: is it us or is it you.
    ...(hosted ? [{ name: "Status", href: "/status", external: true }] : []),
    { name: "Settings", href: `/dashboard/settings${qs}` },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-center rounded-full transition-shadow ${
          open ? "ring-2 ring-gray-900 ring-offset-2" : "hover:ring-2 hover:ring-line-strong hover:ring-offset-2"
        }`}
      >
        <Avatar name={who.email ?? name} src={who.avatar} size="md" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line-faint px-3.5 py-3">
            <p className="truncate text-sm font-medium text-fg">{name}</p>
            {who.email && <p className="truncate text-xs text-fg-muted">{who.email}</p>}
          </div>
          <nav className="py-1">
            {items.map((item) =>
              "external" in item ? (
                // A route that redirects off this host: a plain link, not a
                // client-side navigation.
                <a key={item.name} role="menuitem" href={item.href} target="_blank" rel="noreferrer" className="block px-3.5 py-1.5 text-sm text-fg-secondary hover:bg-sunken hover:text-fg">
                  {item.name}
                </a>
              ) : (
              <Link
                key={item.name}
                role="menuitem"
                href={item.href}
                className="block px-3.5 py-1.5 text-sm text-fg-secondary hover:bg-sunken hover:text-fg"
              >
                {item.name}
              </Link>
              ),
            )}
          </nav>
          <div className="border-t border-line-faint py-1">
            <button
              role="menuitem"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                router.push("/login");
              }}
              className="block w-full px-3.5 py-1.5 text-left text-sm text-fg-secondary hover:bg-sunken hover:text-fg"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
