"use client";

// One square in a flow's run sparkline.
//
// The dot itself is server-renderable; its tooltip is not. The title carried
// `new Date(r.startedAt).toLocaleString()` computed in a server component,
// which formats on the box — so every viewer read the run's start time on the
// server's clock. Same bug LocalTime was written for, in an attribute where a
// component cannot be nested.
//
// The non-time part of the label is passed in already assembled, so the
// server still owns everything it can and only the timestamp waits for the
// browser to say what timezone it is in.

import Link from "@foldrun/ui/react/link";
import { useViewerTime } from "@/components/viewer-time";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export function RunDot({
  href,
  label,
  startedAt,
  className,
}: {
  href: string;
  label: string;
  startedAt: string;
  className?: string;
}) {
  // Same clock as every other timestamp on the page — the profile's zone if
  // there is one, the browser's otherwise.
  const when = useViewerTime(startedAt);

  return (
    <Tooltip label={when ? `${label} · ${when}` : label}>
      <Link href={href} aria-label={when ? `${label} · ${when}` : label} className={className} />
    </Tooltip>
  );
}
