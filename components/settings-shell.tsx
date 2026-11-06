// Settings pages share one shape, cloudhost's: a narrow centred column, a
// big title and one line, underline tabs when the area has several pages
// (each a URL: a route or `?tab=`), then the settings cards stacked, the
// Danger zone last. Server-safe: the tabs are the kit's client PageTabs.

import type { ReactNode } from "react";
import { Page, PageHeader, type PageWidth } from "./kit/page";
import { PageTabs, type PageTab } from "./kit/page-tabs";
import { cn } from "./kit/cn";

/** Kept for older callers: one entry of the old left-hand section list. */
export interface SettingsNavItem {
  id: string;
  label: string;
  danger?: boolean;
  group?: string;
}

export function SettingsShell({
  title,
  subtitle,
  above,
  tabs,
  actions,
  back,
  width = "narrow",
  children,
}: {
  /** Ignored: sections are tabs now. Kept so an older call still compiles. */
  nav?: SettingsNavItem[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** A notice over the content — "Connected", a money line. */
  above?: ReactNode;
  /** The area's pages, as underline tabs under the title. */
  tabs?: PageTab[];
  actions?: ReactNode;
  back?: { href: string; label: string };
  width?: PageWidth;
  children: ReactNode;
}) {
  return (
    <Page width={width} className="pb-16">
      <PageHeader title={title} description={subtitle} actions={actions} back={back} className={tabs ? "mb-6" : undefined} />
      {tabs && tabs.length > 1 && <PageTabs tabs={tabs} />}
      {above && <div className="mb-6">{above}</div>}
      <div>{children}</div>
    </Page>
  );
}

/**
 * A group of settings cards under one heading (title outside the cards, as
 * cloudhost's Panel). The id is the anchor old links (`#provider`) jump to.
 */
export function SettingsSection({
  id,
  title,
  description,
  action,
  danger = false,
  children,
  className,
}: {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  /** A control beside the title — a button, a count. */
  action?: ReactNode;
  danger?: boolean;
  /** Kept for older callers; every section takes the column's width now. */
  wide?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 scroll-mt-20", (title || action) && "pt-6 first:pt-0", className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            {title && <h2 className={cn("text-base font-medium", danger ? "text-danger" : "text-fg")}>{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A row of one fact with a state dot — for the security checks, where a
 *  green or amber card the size of a paragraph said less than a line. */
export function StatusRow({ ok, title, detail }: { ok: boolean; title: string; detail: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className={cn("mt-1.5 inline-block size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-warning")} aria-label={ok ? "good" : "needs attention"} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{detail}</p>
      </div>
    </div>
  );
}
