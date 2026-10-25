"use client";

// The one clock the dashboard reads times in.
//
// Precedence, and it is the whole rule:
//
//   1. the person's saved zone, if they set one on their profile
//   2. otherwise their browser's own zone
//
// Nothing else formats a timestamp for a viewer. The provider is mounted once
// in the dashboard layout with the saved preference (usually null), so every
// client component below it agrees — one place decides, and "8:26 AM" means
// the same thing on every page of a session.
//
// A flow's `timezone:` is deliberately NOT this. That says when work should
// HAPPEN and belongs to the schedule; this says how a person reads a moment
// that already passed.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const ViewerTimeZone = createContext<string | null>(null);

export function ViewerTimeZoneProvider({
  timezone,
  children,
}: {
  timezone: string | null;
  children: ReactNode;
}) {
  return <ViewerTimeZone.Provider value={timezone}>{children}</ViewerTimeZone.Provider>;
}

/**
 * The zone to format in, or undefined for "let the browser decide".
 *
 * undefined rather than a detected string, so it can be handed straight to
 * Intl as `{ timeZone }` — omitting the option is exactly what "automatic"
 * means, and resolving it ourselves would only invent a value to pass back.
 */
export function useViewerTimeZone(): string | undefined {
  return useContext(ViewerTimeZone) ?? undefined;
}

/**
 * The viewer's zone as a concrete string — their choice, or what the browser
 * reports. Use this where a real zone name has to be WRITTEN somewhere (a new
 * flow's `timezone:`), as opposed to merely formatted, where undefined already
 * means "the browser decides".
 */
export function useResolvedTimeZone(): string {
  const chosen = useViewerTimeZone();
  const detected = useDetectedTimeZone();
  return chosen ?? detected;
}

/** What the browser reports, for showing a person what automatic resolves to. */
export function useDetectedTimeZone(): string {
  const [tz, setTz] = useState("");
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);
  return tz;
}

/**
 * Format an instant for the viewer. Rendered empty on the server and filled
 * after hydration, so the HTML the server sends never disagrees with what the
 * client computes — the server has no business guessing a viewer's clock.
 */
export function useViewerTime(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const timeZone = useViewerTimeZone();
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      setText(new Date(iso).toLocaleString(undefined, { ...opts, timeZone }));
    } catch {
      setText(new Date(iso).toLocaleString());
    }
    // opts is a fresh object each render; its identity must not drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, timeZone]);
  return text;
}
