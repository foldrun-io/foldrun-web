"use client";

// The one in-app link. Next's own <Link> prefetches every route as its link
// scrolls into view: a dashboard page shows 10–30 links, so each page load
// asked the server for 10–30 renders nobody had asked for (dev, 7 Nov 2026:
// 7–26 prefetches per page on one web pod). This one waits for intent —
// a hover, a focus or a touch — and then prefetches as Next would. An
// explicit `prefetch` from the caller still wins.

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";

export type LinkProps = ComponentProps<typeof NextLink>;

export default function Link({ prefetch, onMouseEnter, onFocus, onTouchStart, ...props }: LinkProps) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch !== undefined ? prefetch : intent ? null : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}

export { Link };
