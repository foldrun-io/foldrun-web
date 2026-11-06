"use client";

// The person, top right: who is signed in, their pages (profile, usage or
// billing, docs, help, what's new, status, settings), the theme, sign out.
// The sidebar is for the work; this is for who you are.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CircleHelp, CreditCard, Ellipsis, ExternalLink, LogOut, Monitor, Moon, Settings, Sparkles, Sun, User, BarChart3, Activity } from "lucide-react";
import { Avatar } from "./avatar";
import { useHosted } from "./edition";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./kit/menu";
import { cn } from "./kit/cn";
import { THEMES, type Theme } from "./theme-model";

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function currentTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

export function UserMenu({ wide = false }: { wide?: boolean } = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const tenantParam = params.get("tenant") ?? "default";
  const qs = tenantParam !== "default" ? `?tenant=${tenantParam}` : "";
  const hosted = useHosted();

  const [who, setWho] = useState<{ email?: string; tenant?: string; avatar?: string | null }>({});
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { user?: { email?: string; tenant?: string; avatar?: string | null } }) => setWho(d.user ?? {}))
      .catch(() => {});
  }, []);

  // The same save the Appearance card makes: paint at once, keep it with
  // the person, put it back if the save is refused.
  const setTheme = async (next: Theme) => {
    const before = currentTheme();
    if (next === before) return;
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => null);
    if (res && !res.ok && res.status !== 401 && res.status !== 400) {
      document.documentElement.dataset.theme = before;
      setThemeState(before);
    }
  };

  const name = who.tenant ?? tenantParam;
  const items = [
    { name: "Profile", href: `/dashboard/profile${qs}`, icon: User },
    hosted ? { name: "Billing", href: `/dashboard/billing${qs}`, icon: CreditCard } : { name: "Usage", href: `/dashboard/usage${qs}`, icon: BarChart3 },
    { name: "Account settings", href: `/dashboard/settings${qs}`, icon: Settings },
  ];
  const help = [
    { name: "Docs", href: `/dashboard/docs${qs}`, icon: BookOpen },
    { name: "Help", href: `/dashboard/help${qs}`, icon: CircleHelp },
    { name: "What's new", href: `/dashboard/whats-new${qs}`, icon: Sparkles },
  ];

  return (
    <Menu onOpenChange={(o) => o && setThemeState(currentTheme())}>
      <MenuTrigger asChild>
        {wide ? (
          <button
            aria-label="Account menu"
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-muted"
          >
            <Avatar name={who.email ?? name} src={who.avatar} size="sm" />
            <span className="min-w-0 truncate text-sm text-fg">{who.email ?? name}</span>
            <Ellipsis className="ml-auto size-4 shrink-0 text-fg-muted" aria-hidden />
          </button>
        ) : (
          <button
            aria-label="Account menu"
            className="flex items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:ring-2 data-[state=open]:ring-fg"
          >
            <Avatar name={who.email ?? name} src={who.avatar} size="md" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent className="w-64" side={wide ? "top" : "bottom"} align={wide ? "start" : "end"}>
        <div className="px-2 pb-2 pt-1.5">
          <p className="text-xs text-fg-muted">Signed in as</p>
          <p className="truncate text-sm text-fg">{who.email ?? name}</p>
        </div>
        <MenuSeparator />
        {items.map((i) => (
          <MenuItem key={i.name} asChild>
            <Link href={i.href}>
              <i.icon />
              {i.name}
            </Link>
          </MenuItem>
        ))}
        <MenuSeparator />
        {help.map((i) => (
          <MenuItem key={i.name} asChild>
            <Link href={i.href}>
              <i.icon />
              {i.name}
            </Link>
          </MenuItem>
        ))}
        {hosted && (
          <MenuItem asChild>
            {/* A route that redirects off this host: a plain link. */}
            <a href="/status" target="_blank" rel="noreferrer">
              <Activity />
              Status
              <ExternalLink className="ml-auto size-3.5!" />
            </a>
          </MenuItem>
        )}
        <MenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm text-fg-secondary">Theme</span>
          <div role="radiogroup" aria-label="Theme" className="flex items-center rounded-full border border-line p-0.5">
            {THEMES.map((t) => {
              const Icon = THEME_ICON[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  aria-label={t[0].toUpperCase() + t.slice(1)}
                  onClick={() => void setTheme(t)}
                  className={cn("flex size-6 items-center justify-center rounded-full transition-colors", theme === t ? "bg-muted text-fg" : "text-fg-muted hover:text-fg")}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        </div>
        <MenuSeparator />
        <MenuItem
          onSelect={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login");
          }}
        >
          <LogOut />
          Sign out
        </MenuItem>
        <MenuLabel className="sr-only">Account</MenuLabel>
      </MenuContent>
    </Menu>
  );
}
