"use client";

// A timestamp in the viewer's own clock.
//
// The runs table formatted dates in a server component, which means
// toLocaleString ran on the box — so every viewer saw the server's clock,
// and "8:26 AM" meant nothing to someone in another city.
//
// Which clock that is now comes from one place, useViewerTime: the zone the
// person saved on their profile, or their browser's if they saved none. This
// component is the rendering; viewer-time.tsx is the decision.
//
// Rendered empty on the server and filled after hydration, so the HTML the
// server sends never disagrees with what the client computes.

import { useViewerTime } from "./viewer-time";

export function LocalTime({
  iso,
  className,
  options,
}: {
  iso: string;
  className?: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const text = useViewerTime(iso, options);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text || "…"}
    </time>
  );
}
