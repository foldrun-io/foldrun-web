"use client";

// PageTabs: Vercel's underline tabs, the only tab bar. Two modes:
//
//   links    each tab has an `href` (the URL is the state, so Back and a
//            shared link work); the active one is worked out from the path
//            and, when a tab names one, a query key.
//   buttons  `value` + `onChange`: tabs inside a drawer or a panel whose
//            state is the component's — role="tablist", each a role="tab".
//
// For a small switch of two or three views inside a toolbar, use Segmented.
import Link from "@/components/kit/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "./cn";
import { Count } from "./page";

export type PageTab = {
  label: string;
  /** Links mode: where the tab goes. */
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

const TAB = (on: boolean) =>
  cn(
    "relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    on ? "text-fg" : "text-fg-muted hover:text-fg",
    "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
    on ? "after:bg-fg" : "after:bg-transparent",
  );

export function PageTabs(props: {
  tabs: PageTab[];
  className?: string;
  sticky?: boolean;
  /** The bar's accessible name. */
  label?: string;
}): React.ReactElement;
export function PageTabs<K extends string>(props: {
  tabs: { key: K; label: React.ReactNode; badge?: React.ReactNode }[];
  /** Buttons mode: the shown tab, and how to change it. */
  value: K;
  onChange: (key: K) => void;
  className?: string;
  label?: string;
}): React.ReactElement;
export function PageTabs(props: {
  tabs: (PageTab | { key: string; label: React.ReactNode; badge?: React.ReactNode })[];
  value?: string;
  onChange?: (key: string) => void;
  className?: string;
  sticky?: boolean;
  label?: string;
}) {
  return props.onChange ? (
    <StateTabs {...(props as Parameters<typeof StateTabs>[0])} />
  ) : (
    <LinkTabs {...(props as Parameters<typeof LinkTabs>[0])} />
  );
}

function LinkTabs({
  tabs,
  className,
  sticky = false,
  label = "Sections",
}: {
  tabs: PageTab[];
  className?: string;
  sticky?: boolean;
  label?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  // When several tabs could match (one names a query key, one does not), the
  // most specific wins.
  const scored = tabs.map((t) => ({ t, on: isActive(t, pathname, params), weight: [...new URL(t.href, "http://x").searchParams.keys()].length }));
  const best = scored.filter((s) => s.on).sort((a, b) => b.weight - a.weight)[0]?.t;
  return (
    <nav
      aria-label={label}
      className={cn("-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:-mx-6 sm:px-6", sticky && "sticky top-14 z-20 bg-paper/90 backdrop-blur", className)}
    >
      <ul className="flex min-w-max items-center gap-0.5">
        {tabs.map((t) => {
          const on = t === best;
          return (
            <li key={t.href + t.label}>
              <Link href={t.href} aria-current={on ? "page" : undefined} className={TAB(on)}>
                {t.label}
                {t.badge != null && <Count>{t.badge}</Count>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The same bar, driven by the caller's state: role="tablist". */
function StateTabs<K extends string>({
  tabs,
  value,
  onChange,
  label = "Sections",
  className,
}: {
  tabs: { key: K; label: React.ReactNode; badge?: React.ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("-mx-4 mb-6 flex gap-0.5 overflow-x-auto border-b border-line px-4 sm:-mx-6 sm:px-6", className)}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)} className={TAB(t.key === value)}>
          {t.label}
          {t.badge != null && <Count>{t.badge}</Count>}
        </button>
      ))}
    </div>
  );
}
