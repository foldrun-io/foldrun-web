"use client";

// The person, top right: who is signed in, their pages (profile, usage or
// billing, docs, help, what's new, status, settings), the theme, sign out.
// The sidebar is for the work; this is for who you are.

import { $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, BookOpen, CircleHelp, CreditCard, Ellipsis, ExternalLink, LogOut, Monitor, Moon, Settings, Sparkles, Sun, User, BarChart3, Activity } from "lucide-react";
import { Avatar } from "./avatar";
import { useHosted } from "./edition";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@foldrun/ui/react/menu";
import { Segmented } from "@foldrun/ui/react/segmented";
import { THEMES, type Theme } from "./theme-model";
import { LanguageMenuItems } from "./language-switch";
import { ROLE_LABEL } from "./value-labels";
import { Toast } from "@foldrun/ui/react/toast";

/** Tabs of one browser tell each other when the session moved to another account. */
const ACCOUNT_CHANNEL = "foldrun-account";

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

  const [who, setWho] = useState<{ email?: string; tenant?: string; avatar?: string | null; accounts?: { tenant: string; role: string; current: boolean }[] }>({});
  const [theme, setThemeState] = useState<Theme>("system");
  const [switchFailed, setSwitchFailed] = useState(false);

  useEffect(() => {
    // The cookie is every tab's, and a session is for one account (FOL-464).
    // When another tab moves it, this page is showing an account its next
    // click would no longer act in: it reloads, at once when the other tab
    // says so, and when it is looked at again otherwise.
    let shown: string | undefined;
    const look = (first: boolean) =>
      fetch("/v1/auth/session")
        .then((r) => (r.ok ? r.json() : {}))
        .then((d: { user?: typeof who }) => {
          if (first) {
            shown = d.user?.tenant;
            setWho(d.user ?? {});
          } else if (shown && d.user?.tenant && d.user.tenant !== shown) window.location.reload();
        })
        .catch(() => {});
    void look(true);
    const onFocus = () => document.visibilityState === "visible" && void look(false);
    document.addEventListener("visibilitychange", onFocus);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(ACCOUNT_CHANNEL);
    if (channel) channel.onmessage = () => window.location.reload();
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      channel?.close();
    };
  }, []);

  // The same save the Appearance card makes: paint at once, keep it with
  // the person, put it back if the save is refused.
  const setTheme = async (next: Theme) => {
    const before = currentTheme();
    if (next === before) return;
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    const res = await fetch("/v1/me/preferences", {
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
  // One login may be in several accounts (FOL-464): the session is for one,
  // and choosing another makes a new session there and loads the dashboard.
  const accounts = (who.accounts?.length ?? 0) > 1 ? who.accounts! : [];
  const openAccount = async (account: string) => {
    const res = await fetch("/v1/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) }).catch(() => null);
    if (res?.ok) {
      if (typeof BroadcastChannel !== "undefined") new BroadcastChannel(ACCOUNT_CHANNEL).postMessage("moved");
      window.location.assign(new URL("/dashboard", window.location.origin).href);
    } else setSwitchFailed(true);
  };
  const items = [
    { name: $t("components.user-menu.profile"), href: `/dashboard/profile${qs}`, icon: User },
    hosted ? { name: $t("components.user-menu.billing"), href: `/dashboard/billing${qs}`, icon: CreditCard } : { name: $t("components.user-menu.usage"), href: `/dashboard/usage${qs}`, icon: BarChart3 },
    // "Settings": the sidebar, the page title and every pointer to it in the
    // docs and messages use that word (8 Nov 2026); under the person's name
    // the menu already says whose it is.
    { name: $t("components.user-menu.settings"), href: `/dashboard/settings${qs}`, icon: Settings },
  ];
  const help = [
    { name: $t("components.user-menu.docs"), href: `/dashboard/docs${qs}`, icon: BookOpen },
    { name: $t("components.user-menu.help"), href: `/dashboard/help${qs}`, icon: CircleHelp },
    { name: $t("components.user-menu.whatSNew"), href: `/dashboard/whats-new${qs}`, icon: Sparkles },
  ];

  return (
    <>
    {switchFailed && <Toast onDone={() => setSwitchFailed(false)}>{$t("components.user-menu.switchFailed")}</Toast>}
    <Menu onOpenChange={(o) => o && setThemeState(currentTheme())}>
      <MenuTrigger asChild>
        {wide ? (
          <button
            aria-label={$t("components.user-menu.accountMenu")}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-muted"
          >
            <Avatar name={who.email ?? name} src={who.avatar} size="sm" />
            <span className="min-w-0 truncate text-sm text-fg">{who.email ?? name}</span>
            <Ellipsis className="ms-auto size-4 shrink-0 text-fg-muted" aria-hidden />
          </button>
        ) : (
          <button
            aria-label={$t("components.user-menu.accountMenu")}
            className="flex items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:ring-2 data-[state=open]:ring-fg"
          >
            <Avatar name={who.email ?? name} src={who.avatar} size="md" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent className="w-64" side={wide ? "top" : "bottom"} align={wide ? "start" : "end"}>
        <div className="px-2 pb-2 pt-1.5">
          <p className="text-xs text-fg-muted">{$t("components.user-menu.signedInAs")}</p>
          <p className="truncate text-sm text-fg">{who.email ?? name}</p>
        </div>
        {accounts.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>{$t("components.user-menu.accounts")}</MenuLabel>
            {accounts.map((a) => (
              <MenuItem key={a.tenant} disabled={a.current} onSelect={() => void openAccount(a.tenant)}>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.tenant}</span>
                <span className="text-xs text-fg-muted">{ROLE_LABEL[a.role] ?? a.role}</span>
                {a.current && <Check className="size-3.5!" aria-hidden />}
              </MenuItem>
            ))}
          </>
        )}
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
              {$t("components.user-menu.status")}
              <ExternalLink className="ms-auto size-3.5!" />
            </a>
          </MenuItem>
        )}
        <MenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm text-fg-secondary">{$t("components.user-menu.theme")}</span>
          <Segmented
            role="radiogroup"
            size="sm"
            label={$t("components.user-menu.theme")}
            value={theme}
            onChange={(t) => void setTheme(t as Theme)}
            items={THEMES.map((t) => {
              const Icon = THEME_ICON[t];
              return { key: t, icon: <Icon />, title: t[0].toUpperCase() + t.slice(1) };
            })}
          />
        </div>
        <LanguageMenuItems />
        <MenuSeparator />
        <MenuItem
          onSelect={async () => {
            await fetch("/v1/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login");
          }}
        >
          <LogOut />
          {$t("components.user-menu.signOut")}
        </MenuItem>
        <MenuLabel className="sr-only">{$t("components.user-menu.account")}</MenuLabel>
      </MenuContent>
    </Menu>
    </>
  );
}
