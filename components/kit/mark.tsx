// The foldrun mark: the folder with its run light. One drawing for every
// place it appears (the sidebar, the phone bar, the sign-in card). One
// colour (7 Nov 2026): the light is the mark's own colour, black on light and
// white on dark; green stays for status. The ring behind the light is the
// surface the mark sits on (`on`), so the dot never touches the outline.
// Server-safe.

import { cn } from "./cn";

const RING = { paper: "var(--color-paper-deep)", surface: "var(--color-surface)" } as const;

export function FoldrunMark({ size = 20, on = "paper", className }: { size?: number; on?: keyof typeof RING; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-fg", className)} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 11h18" />
      <circle cx="20.6" cy="19.4" r="3" fill={RING[on]} stroke="none" />
      <circle cx="20.6" cy="19.4" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
