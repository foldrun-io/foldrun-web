"use client";

// The top-left of every dashboard page: account / workspace, each a
// switcher with a find box, the way Vercel's team / project pair works.
// Where you are is always readable in one line, and either half is a
// click away from anywhere else — with a few letters typed, if the list
// is long.
//
// The account switcher lists exactly one account today: one user owns one
// tenant, and a team is people joining that tenant, not a second tenant.
// The control is here anyway so the shape is right when memberships arrive;
// its footer is the honest action, which is inviting people.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { scoreHit } from "./find-model";
import { workspaceOf } from "./sidebar";
import { Avatar } from "./avatar";

interface Item {
  name: string;
  href: string;
  current?: boolean;
  avatar?: string | null;
  square?: boolean;
  /** Right-hand meta: a plan badge, counts. */
  meta?: string;
  badge?: string;
}

function Chevrons() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-subtle">
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function Switcher({
  trigger,
  label,
  placeholder,
  items,
  footer,
  empty,
}: {
  trigger: ReactNode;
  label: string;
  placeholder: string;
  items: Item[];
  footer: { title: string; hint: string; href: string };
  empty: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setQ("");
    setActive(0);
    setOpen(true);
  };
  // A navigation closes it — adjusted during render rather than in an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  // The same close discipline as every menu here: a click anywhere else, or
  // Escape, puts it away; a navigation closes it.
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
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const shown = items
    .map((it) => ({ it, score: scoreHit(q, it.name) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ it }) => it);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch ${label}`}
        onClick={toggle}
        className="flex max-w-[16rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-fg hover:bg-muted"
      >
        {trigger}
        <Chevrons />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
          <div className="flex items-center gap-2 border-b border-line-faint px-3">
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
              className="h-10 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">Esc</kbd>
          </div>
          <ul role="listbox" className="max-h-72 overflow-auto py-1">
            {shown.map((it, i) => (
              <li key={it.name}>
                <Link
                  href={it.href}
                  data-index={i}
                  role="option"
                  aria-selected={!!it.current}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-sm ${i === active ? "bg-muted" : ""} ${it.current ? "font-medium text-fg" : "text-fg-secondary"}`}
                >
                  <Avatar name={it.name} src={it.avatar} size="sm" square={it.square} />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.badge && <span className="rounded-full border border-line px-1.5 text-[10px] text-fg-muted">{it.badge}</span>}
                  {it.meta && <span className="shrink-0 text-[11px] text-fg-subtle">{it.meta}</span>}
                  {it.current && <Check />}
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-xs text-fg-subtle">{q ? `Nothing matches “${q}”.` : empty}</li>}
          </ul>
          <Link
            href={footer.href}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 border-t border-line-faint px-3 py-2.5 hover:bg-sunken"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line-strong text-fg-muted">+</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{footer.title}</span>
              <span className="block text-xs text-fg-muted">{footer.hint}</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

interface WorkspaceRow {
  name: string;
  agents: number;
  flows: number;
  avatar?: string | null;
}

export function TopBar({
  account: accountProp,
  plan,
  workspaces: workspacesProp,
  accountAvatar = null,
}: {
  account: string;
  /** The plan badge, hosted only: "Metered" when billing is enforced,
   *  "Free" otherwise. null renders none. */
  plan: string | null;
  workspaces: WorkspaceRow[];
  accountAvatar?: string | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const urlTenant = params.get("tenant") ?? "default";
  // The server hands this the session's account and its workspaces as a
  // first paint; the client then asks the API on every navigation, with
  // the tenant the URL names. A layout's session read is not always what
  // the page's is — on the box it came back empty and the bar said
  // "default" with no workspaces — and a list fetched the way the pages
  // read their data is the one that agrees with them.
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
  const account = live?.account ?? (urlTenant !== "default" ? urlTenant : accountProp);
  const workspaces = live?.workspaces ?? workspacesProp;
  const avatar = live ? live.avatar : accountAvatar;
  const tenant = account;
  const first = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  const workspace = workspaceOf(pathname);

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Switcher
        label="account"
        placeholder="Find account…"
        trigger={
          <>
            <Avatar name={account} src={avatar} size="xs" />
            <span className="truncate">{account}</span>
            {plan && <span className="rounded-full border border-line bg-sunken px-1.5 text-[10px] font-medium text-fg-muted">{plan}</span>}
          </>
        }
        items={[{ name: account, href: `/dashboard${first}`, current: true, badge: plan ?? undefined, avatar }]}
        footer={{ title: "Invite people", hint: "Add teammates to this account", href: `/dashboard/settings${first}` }}
        empty="Accounts you belong to appear here."
      />
      <span className="px-1 text-gray-300">/</span>
      <Switcher
        label="workspace"
        placeholder="Find workspace…"
        trigger={<span className="truncate">{workspace ?? "All workspaces"}</span>}
        items={[
          { name: "All workspaces", href: `/dashboard${first}`, current: workspace === null },
          ...workspaces.map((w) => ({
            name: w.name,
            href: `/dashboard/${w.name}${first}`,
            current: w.name === workspace,
            meta: `${w.agents}a · ${w.flows}f`,
            avatar: w.avatar ?? null,
            square: true,
          })),
        ]}
        footer={{ title: "Create workspace", hint: "Its own agents, flows, secrets and runs", href: `/dashboard?create=workspace${rest}` }}
        empty="No workspaces yet."
      />
    </div>
  );
}
