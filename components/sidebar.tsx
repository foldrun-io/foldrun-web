"use client";

// The sidebar (UI refactor, Nov 2026), cloudhost's shape: the account at the
// top, Find under it, then the doors from nav-model.ts as a quiet list with a
// hairline between groups — or, inside a workspace, that workspace's own
// doors under a way back to every workspace — and the person and the bell at
// the foot. It can be hidden (Ctrl/⌘ B, remembered in this browser); on a
// phone it opens as a sheet from the floating bar (mobile-nav.tsx).

import Link from "@foldrun/ui/react/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  Activity, AlertCircle, BarChart3, Bot, Boxes, ChevronLeft, ChevronRight, CreditCard, FlaskConical, FolderTree, HardDrive, History, Inbox,
  LayoutGrid, Library, Play, Settings, Share2, ShieldCheck, Workflow, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { FindTrigger } from "./find";
import { useHosted } from "./edition";
import { accountNav, workspaceNav, workspaceOf, pageTitle, type Nav, type NavIcon } from "./nav-model";
import { AccountSwitcher } from "./topbar";
import { UserMenu } from "./user-menu";
import { InboxLink, useInboxUnread } from "./inbox-link";
import { cn } from "@foldrun/ui/react/cn";
import { Count } from "@foldrun/ui/react/page";

export { workspaceOf, ACCOUNT_SEGMENTS } from "./nav-model";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutGrid,
  runs: Play,
  observe: Activity,
  flows: Workflow,
  agents: Bot,
  evals: FlaskConical,
  triggers: Zap,
  files: FolderTree,
  tools: Wrench,
  storage: HardDrive,
  checks: ShieldCheck,
  graph: Share2,
  history: History,
  settings: Settings,
  workspaces: Boxes,
  inbox: Inbox,
  issues: AlertCircle,
  library: Library,
  usage: BarChart3,
  billing: CreditCard,
};

// Hidden or not is a preference of this browser, read as an external store
// so the server paints it shown, the first client paint agrees, and the
// remembered choice arrives without an effect.
const RAIL_KEY = "foldrun:sidebar-hidden";
const RAIL_EVENT = "foldrun:sidebar-hidden";
function readHidden(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeHidden(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(RAIL_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(RAIL_EVENT, cb);
  };
}
export function setSidebarHidden(v: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(RAIL_EVENT));
}
export function useSidebarHidden() {
  return useSyncExternalStore(subscribeHidden, readHidden, () => false);
}

/** The foldrun mark: a folder with its run light. */
export { FoldrunMark } from "@foldrun/ui/react/mark";

/** The navigation for the current page. */
export function useNav(): Nav & { workspace: string | null; tenant: string; title: string | null } {
  const pathname = usePathname();
  const params = useSearchParams();
  const hosted = useHosted();
  const unread = useInboxUnread();
  const tenant = params.get("tenant") ?? "default";
  const workspace = workspaceOf(pathname);
  const nav = workspace ? workspaceNav(workspace, pathname, params, tenant) : accountNav(pathname, tenant, hosted, { inbox: unread ?? undefined });
  return { ...nav, workspace, tenant, title: pageTitle(pathname) ?? nav.current?.name ?? null };
}

const rowClass = (on: boolean) =>
  cn(
    "group flex h-[37px] w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    on ? "bg-muted text-fg" : "text-fg-secondary hover:bg-muted/60 hover:text-fg",
  );

/** The list itself: the account's doors, or a workspace's under a way back. */
export function NavList({ nav, onPick }: { nav: Nav; onPick?: () => void }) {
  return (
    <>
      {nav.back && (
        <Link href={nav.back.href} onClick={onPick} className="mb-2 flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-fg hover:bg-muted/60">
          <ChevronLeft className="size-4 shrink-0 text-fg-muted" aria-hidden />
          {nav.back.label}
        </Link>
      )}
      {nav.sections.map((sec, si) => (
        <ul key={si} className={cn("space-y-0.5", si > 0 && "mt-2 border-t border-line pt-2")}>
          {sec.items.map((it) => {
            const Icon = NAV_ICONS[it.icon];
            return (
              <li key={it.name}>
                <Link href={it.href} onClick={onPick} aria-current={it.on ? "page" : undefined} className={rowClass(it.on)}>
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 truncate">{it.name}</span>
                  {!!it.badge && <Count tone="warn" className="ml-auto min-w-0 text-[11px] leading-4">{it.badge > 99 ? "99+" : it.badge}</Count>}
                  {it.more && !it.badge && <ChevronRight className="ml-auto size-4 shrink-0 text-fg-subtle" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </>
  );
}

export function Sidebar() {
  const hidden = useSidebarHidden();
  const nav = useNav();

  // Ctrl/⌘ B hides and shows it, as in cloudhost and VS Code.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarHidden(!readHidden());
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (hidden) return null;
  return (
    <aside aria-label="Main" className="sticky top-0 hidden h-svh w-[260px] shrink-0 flex-col border-r border-line bg-paper md:flex">
      <div className="px-2 pb-2 pt-2">
        <AccountSwitcher />
      </div>
      <div className="px-2 pb-2">
        <FindTrigger />
      </div>
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <NavList nav={nav} />
      </nav>
      <div className="flex shrink-0 items-center gap-1 px-2 py-2">
        <UserMenu wide />
        <InboxLink />
      </div>
    </aside>
  );
}
