"use client";

// Settings pages share one shape: a sticky list of sections on the left,
// the sections on the right, each with a title and one line saying what it
// is for. The list is a map and a jump table — the page used to be nine
// cards in a column, and finding the one you wanted meant scrolling past
// the eight you did not. The current section is marked as you scroll.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Workbench, Pane } from "./pane";

export interface SettingsNavItem {
  id: string;
  label: string;
  /** Marks a destructive section in the list. */
  danger?: boolean;
  /** A heading the list shows above the first item of each group — "The
   *  four jobs", "Setup". Items keep the page's order. */
  group?: string;
}

export function SettingsShell({
  nav,
  title,
  subtitle,
  above,
  children,
}: {
  nav: SettingsNavItem[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** A line over the content — the workspace's money line. */
  above?: ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string>(nav[0]?.id ?? "");
  const pane = useRef<HTMLDivElement>(null);

  // A clicked (or linked-to) section stays marked until the reader scrolls
  // themselves: at the foot of the pane several sections share the screen,
  // and the one you asked for is the one you are reading. Otherwise the
  // current section is the last whose top has passed a line a little below
  // the top of the pane. The content pane scrolls, not the window — the
  // same two-pane shape as the editor.
  const [pinned, setPinned] = useState<string | null>(() => (typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") || null : null));
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top;
      let current = nav[0]?.id ?? "";
      for (const n of nav) {
        const section = document.getElementById(n.id);
        if (section && section.getBoundingClientRect().top - top <= 80) current = n.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const unpin = () => setPinned(null);
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    el.addEventListener("wheel", unpin, { passive: true });
    el.addEventListener("touchmove", unpin, { passive: true });
    window.addEventListener("keydown", unpin);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      el.removeEventListener("wheel", unpin);
      el.removeEventListener("touchmove", unpin);
      window.removeEventListener("keydown", unpin);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [nav]);
  const marked = pinned && nav.some((n) => n.id === pinned) ? pinned : active;

  return (
    <Workbench>
      <Pane
        side="left"
        className="max-md:hidden"
        head={
          <div className="px-4 py-3">
            <h1 className="font-cal text-base tracking-tight text-fg">{title}</h1>
          </div>
        }
      >
        <nav className="px-2 py-2" aria-label="Settings sections">
          <ul className="space-y-0.5">
            {nav.map((n, i) => (
              <li key={n.id}>
                {n.group && n.group !== nav[i - 1]?.group && (
                  <p className={`px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle ${i > 0 ? "pt-3" : ""}`}>{n.group}</p>
                )}
                <a
                  href={`#${n.id}`}
                  onClick={() => setPinned(n.id)}
                  className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    marked === n.id ? "bg-accent-soft font-medium text-accent" : n.danger ? "text-red-600 hover:bg-red-50" : "text-fg-tertiary hover:bg-muted-strong/40 hover:text-fg"
                  }`}
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Pane>
      <div ref={pane} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-6xl px-4 py-6 md:px-8">
          {above && <div className="mb-4">{above}</div>}
          <div className="mb-8">
            <h1 className="font-cal text-xl font-semibold tracking-tight text-fg md:hidden">{title}</h1>
            {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
            {/* On a narrow screen the list is not there; the sections are still reachable as chips. */}
            <div className="mt-3 flex flex-wrap gap-1.5 md:hidden">
              {nav.map((n) => (
                <a key={n.id} href={`#${n.id}`} className={`rounded-full border px-2.5 py-0.5 text-xs ${n.danger ? "border-red-200 text-red-600" : "border-line text-fg-tertiary"}`}>{n.label}</a>
              ))}
            </div>
          </div>
          <div className="space-y-8 pb-16">{children}</div>
        </div>
      </div>
    </Workbench>
  );
}

/**
 * One section: what it is on the left, the controls on the right.
 *
 * Every settings page used to stack a heading, a sentence, and then a
 * full-width card under it — and at desktop widths that put three password
 * fields side by side across the whole screen, a select stretched to
 * nothing, and buttons floating far from what they saved. This is the
 * layout every mature product settles on: a narrow column that says what
 * the section is, and beside it the form at a width a person can read,
 * with its button under its fields.
 *
 * `wide` is for content that is genuinely a table — a team, a list of
 * sessions, a secrets list — and takes the whole row.
 */
export function SettingsSection({
  id,
  title,
  description,
  action,
  danger = false,
  wide = false,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** A control beside the title — a button, a count. */
  action?: ReactNode;
  danger?: boolean;
  /** Let the content take the full row: tables and lists. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-8 first:border-t-0 first:pt-0">
      <div className={wide ? "space-y-4" : "grid gap-6 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-10"}>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className={`text-base font-semibold ${danger ? "text-red-700" : "text-fg"}`}>{title}</h2>
            {action && <div className="shrink-0">{action}</div>}
          </div>
          {description && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{description}</p>}
        </div>
        <div className={wide ? "min-w-0" : "min-w-0 max-w-2xl"}>{children}</div>
      </div>
    </section>
  );
}

/** A row of one fact with a state dot — for the security checks, where a
 *  green or amber card the size of a paragraph said less than a line. */
export function StatusRow({ ok, title, detail }: { ok: boolean; title: string; detail: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{detail}</p>
      </div>
    </div>
  );
}
