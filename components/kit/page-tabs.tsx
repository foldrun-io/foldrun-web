"use client";

// PageTabs: Vercel's underline tabs under a page header. Each tab is a link
// (the URL is the state, so Back and a shared link work); the active one is
// worked out from the path and, when a tab names one, a query key.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "./cn";

export type PageTab = {
  label: string;
  href: string;
  /** A count or a dot beside the label. */
  badge?: React.ReactNode;
  /** Override the computed active state. */
  active?: boolean;
  /** Match this path prefix as well (a tab whose pages live below it). */
  match?: string;
};

function isActive(tab: PageTab, pathname: string, params: URLSearchParams): boolean {
  if (tab.active !== undefined) return tab.active;
  const url = new URL(tab.href, "http://x");
  if (tab.match && pathname.startsWith(tab.match)) return true;
  if (url.pathname !== pathname) return false;
  // Every query key the tab names (bar tenant) must match the page's.
  for (const [k, v] of url.searchParams) {
    if (k === "tenant") continue;
    if (params.get(k) !== v) return false;
  }
  return true;
}

export function PageTabs({ tabs, className, sticky = false }: { tabs: PageTab[]; className?: string; sticky?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  // When several tabs could match (one names a query key, one does not), the
  // most specific wins.
  const scored = tabs.map((t) => ({ t, on: isActive(t, pathname, params), weight: [...new URL(t.href, "http://x").searchParams.keys()].length }));
  const best = scored.filter((s) => s.on).sort((a, b) => b.weight - a.weight)[0]?.t;
  return (
    <nav
      aria-label="Sections"
      className={cn("-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:-mx-6 sm:px-6", sticky && "sticky top-14 z-20 bg-paper/90 backdrop-blur", className)}
    >
      <ul className="flex min-w-max items-center gap-0.5">
        {tabs.map((t) => {
          const on = t === best;
          return (
            <li key={t.href + t.label}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors",
                  on ? "text-fg" : "text-fg-muted hover:text-fg",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                  on ? "after:bg-fg" : "after:bg-transparent",
                )}
              >
                {t.label}
                {t.badge != null && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-fg-tertiary">{t.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
