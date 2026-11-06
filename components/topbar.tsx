"use client";

// The two switchers, cloudhost's way: the account at the top of the sidebar
// (its avatar stands for it, with the plan beside the name) and the
// workspace at the start of the bar over the content ("All workspaces" or
// one workspace). Each opens a list with a find box; Enter opens the
// highlighted row.
//
// The account switcher lists exactly one account today: one user owns one
// tenant, and a team is people joining that tenant, not a second tenant.
// The control is here anyway so the shape is right when memberships arrive;
// its footer is the honest action, which is inviting people.
//
// ShellData fetches the session's account and its workspaces once per
// navigation, for both: a layout's session read is not always what the
// page's is (on the box it came back empty), and a list fetched the way the
// pages read their data is the one that agrees with them.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { scoreHit } from "./find-model";
import { workspaceOf } from "./nav-model";
import { Avatar } from "./avatar";
import { cn } from "./kit/cn";

interface WorkspaceRow {
  name: string;
  agents: number;
  flows: number;
  avatar?: string | null;
}

type ShellData = { account: string; workspaces: WorkspaceRow[]; avatar: string | null; plan: string | null; loaded: boolean };
const Ctx = createContext<ShellData>({ account: "default", workspaces: [], avatar: null, plan: null, loaded: false });

export function ShellDataProvider({ account: accountProp, plan, accountAvatar = null, children }: { account: string; plan: string | null; accountAvatar?: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const urlTenant = params.get("tenant") ?? "default";
  const [live, setLive] = useState<{ account: string; workspaces: WorkspaceRow[]; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const t = urlTenant !== "default" ? urlTenant : accountProp;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { user?: { tenant?: string; accountAvatar?: string | null } }) => {
        const tenant = d.user?.tenant ?? t;
        return fetch("/api/workspaces", { headers: { "x-foldrun-tenant": tenant } })
          .then((r) => (r.ok ? r.json() : { workspaces: [] }))
          .then((w: { workspaces?: WorkspaceRow[] }) => {
            if (alive) setLive({ account: tenant, workspaces: w.workspaces ?? [], avatar: d.user?.accountAvatar ?? null });
          });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, urlTenant, accountProp]);
  const value: ShellData = {
    account: live?.account ?? (urlTenant !== "default" ? urlTenant : accountProp),
    workspaces: live?.workspaces ?? [],
    avatar: live ? live.avatar : accountAvatar,
    plan,
    loaded: live !== null,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellData = () => useContext(Ctx);

interface Item {
  name: string;
  href: string;
  current?: boolean;
  avatar?: string | null;
  square?: boolean;
  meta?: string;
  badge?: string;
}

function Switcher({
  trigger,
  label,
  placeholder,
  items,
  footer,
  empty,
  triggerClassName,
  align = "start",
}: {
  trigger: ReactNode;
  label: string;
  placeholder: string;
  items: Item[];
  footer: { title: string; href: string };
  empty: string;
  triggerClassName?: string;
  align?: "start" | "stretch";
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A navigation closes it — adjusted during render rather than in an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
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
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onPointer as EventListener, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = items
    .map((it) => ({ it, score: scoreHit(q, it.name) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ it }) => it);

  return (
    <div ref={ref} className={cn("relative min-w-0", align === "stretch" && "w-full")}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch ${label}`}
        onClick={() => {
          setQ("");
          setActive(0);
          setOpen(!open);
        }}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md text-sm font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-muted",
          triggerClassName,
        )}
      >
        {trigger}
        <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      </button>
      {open && (
        <div className={cn("absolute top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-line bg-surface shadow-menu", align === "stretch" ? "inset-x-0 min-w-64" : "left-0 w-72")}>
          <div className="border-b border-line px-3">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(shown.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && shown[active]) {
                  e.preventDefault();
                  ref.current?.querySelector<HTMLAnchorElement>(`[data-index="${active}"]`)?.click();
                }
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-10 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-auto p-1">
            {shown.map((it, i) => (
              <li key={it.name}>
                <Link
                  href={it.href}
                  data-index={i}
                  role="option"
                  aria-selected={!!it.current}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setOpen(false)}
                  className={cn("flex h-9 items-center gap-2.5 rounded-md px-2 text-sm", i === active && "bg-muted", it.current ? "font-medium text-fg" : "text-fg-secondary")}
                >
                  <Avatar name={it.name} src={it.avatar} size="xs" square={it.square} />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.badge && <span className="rounded-full border border-line px-1.5 text-[11px] text-fg-muted">{it.badge}</span>}
                  {it.meta && <span className="shrink-0 text-xs text-fg-subtle">{it.meta}</span>}
                  {it.current && <Check className="size-4 shrink-0 text-fg" aria-hidden />}
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-xs text-fg-subtle">{q ? `Nothing matches “${q}”.` : empty}</li>}
          </ul>
          <Link href={footer.href} onClick={() => setOpen(false)} className="flex h-10 items-center gap-2 border-t border-line px-3 text-sm text-fg-secondary hover:bg-sunken hover:text-fg">
            <Plus className="size-4 text-fg-muted" aria-hidden />
            {footer.title}
          </Link>
        </div>
      )}
    </div>
  );
}

/** The account, at the top of the sidebar. */
export function AccountSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { account, avatar, plan } = useShellData();
  const first = account !== "default" ? `?tenant=${account}` : "";
  return (
    <Switcher
      label="account"
      placeholder="Find account…"
      align="stretch"
      triggerClassName={cn("h-10 w-full px-2", collapsed && "justify-center px-0 [&>svg]:hidden")}
      trigger={
        <>
          <Avatar name={account} src={avatar} size="sm" />
          {!collapsed && (
            <>
              <span className="truncate">{account}</span>
              {plan && <span className="shrink-0 rounded-full border border-line px-1.5 text-[11px] font-normal leading-4 text-fg-muted">{plan}</span>}
              <span className="flex-1" />
            </>
          )}
        </>
      }
      items={[{ name: account, href: `/dashboard${first}`, current: true, badge: plan ?? undefined, avatar }]}
      footer={{ title: "Invite people", href: `/dashboard/settings${first}` }}
      empty="Accounts you belong to appear here."
    />
  );
}

/** The workspace, at the start of the bar: "All workspaces" or one. */
export function WorkspaceSwitcher() {
  const pathname = usePathname();
  const { account, workspaces } = useShellData();
  const first = account !== "default" ? `?tenant=${account}` : "";
  const rest = account !== "default" ? `&tenant=${account}` : "";
  const workspace = workspaceOf(pathname);
  const current = workspaces.find((w) => w.name === workspace);
  return (
    <Switcher
      label="workspace"
      placeholder="Find workspace…"
      triggerClassName="h-8 max-w-[18rem] px-2"
      trigger={
        workspace ? (
          <>
            <Avatar name={workspace} src={current?.avatar ?? null} size="xs" square />
            <span className="truncate">{workspace}</span>
          </>
        ) : (
          <span className="truncate">All workspaces</span>
        )
      }
      items={[
        { name: "All workspaces", href: `/dashboard${first}`, current: workspace === null },
        ...workspaces.map((w) => ({
          name: w.name,
          href: `/dashboard/${w.name}${first}`,
          current: w.name === workspace,
          meta: `${w.agents} agents · ${w.flows} flows`,
          avatar: w.avatar ?? null,
          square: true,
        })),
      ]}
      footer={{ title: "Create workspace", href: `/dashboard?create=workspace${rest}` }}
      empty="No workspaces yet."
    />
  );
}

/** Kept for callers of the old one-piece bar. */
export function TopBar() {
  return <WorkspaceSwitcher />;
}
