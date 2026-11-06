"use client";

// The bars around the content (UI refactor, Nov 2026), cloudhost's shape.
//
//   ShellBar     wider screens: one bar over the content — the sidebar
//                toggle and the workspace switcher at the start, the page's
//                name in the middle, "Create new" and money at the end.
//   PhoneHeader  phones: the mark, the account in the middle, the bell.
//   PhoneBar     phones: a floating pill at the bottom — Find | the menu,
//                which opens the sidebar's list as a sheet from below.
//   StatusFooter a quiet line under every page: the platform's status and
//                the version.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Menu as MenuIcon, PanelLeft, Search } from "lucide-react";
import { FoldrunMark, NavList, setSidebarHidden, useNav, useSidebarHidden } from "./sidebar";
import { Sheet, SheetContent, SheetTitle } from "./kit/dialog";
import { AccountSwitcher, WorkspaceSwitcher } from "./topbar";
import { InboxLink } from "./inbox-link";
import { UserMenu } from "./user-menu";
import { openFind } from "./find";
import { useVersion } from "./version";
import { cn } from "./kit/cn";

export function ShellBar({ actions }: { actions?: ReactNode }) {
  const hidden = useSidebarHidden();
  const { title } = useNav();
  return (
    <div className="sticky top-0 z-30 hidden h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur md:grid">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setSidebarHidden(!hidden)}
          aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
          title={`${hidden ? "Show" : "Hide"} sidebar (Ctrl B)`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <PanelLeft className="size-4" />
        </button>
        <WorkspaceSwitcher />
      </div>
      <p className="max-w-[40vw] truncate text-center text-sm font-medium text-fg">{title}</p>
      <div className="flex min-w-0 items-center justify-end gap-1">{actions}</div>
    </div>
  );
}

export function PhoneHeader() {
  return (
    <header className="sticky top-0 z-30 grid h-14 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur md:hidden">
      <Link href="/dashboard" aria-label="foldrun" className="justify-self-start rounded-md p-1">
        <FoldrunMark />
      </Link>
      <div className="flex min-w-0 justify-center">
        <div className="max-w-full">
          <AccountSwitcher />
        </div>
      </div>
      <div className="justify-self-end">
        <InboxLink />
      </div>
    </header>
  );
}

export function PhoneBar({ actions }: { actions?: ReactNode }) {
  const [more, setMore] = useState(false);
  const nav = useNav();
  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center md:hidden">
        <div className="flex h-12 items-center rounded-2xl border border-line bg-surface/95 shadow-overlay backdrop-blur">
          <button type="button" onClick={() => openFind()} className="flex h-full items-center gap-2 pl-4 pr-5 text-sm text-fg-muted">
            <Search className="size-4" />
            Find
          </button>
          <span className="h-6 w-px bg-line" aria-hidden />
          <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} aria-label="Menu" className="flex h-full items-center px-4 text-fg">
            <MenuIcon className="size-5" />
          </button>
        </div>
      </div>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[88svh] gap-0 p-0" aria-describedby={undefined}>
          <div className="border-b border-line px-4 py-3">
            <SheetTitle className="text-sm">{nav.title ?? "Menu"}</SheetTitle>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <WorkspaceSwitcher />
              {actions}
            </div>
            <NavList nav={nav} onPick={() => setMore(false)} />
          </div>
          <div className="flex items-center gap-2 border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <UserMenu wide />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function StatusFooter({ statusPage }: { statusPage?: string | null }) {
  const version = useVersion();
  return (
    <footer className="mx-auto flex w-full max-w-[calc(var(--container-page)+3rem)] items-center gap-4 border-t border-line px-4 py-3 pb-24 text-xs text-fg-muted sm:px-6 md:pb-3">
      {statusPage ? (
        <a href={statusPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          System status
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-gray-300" aria-hidden />
          System status
        </span>
      )}
      <Link href="/dashboard/whats-new" className={cn("ml-auto font-mono hover:text-fg")}>
        foldrun {version}
      </Link>
    </footer>
  );
}

/** Kept for older imports: the phone's menu now lives in PhoneBar. */
export function MobileNav() {
  return null;
}
