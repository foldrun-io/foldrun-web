"use client";

// The one way to open a file's editor.
//
// This existed four times in three shapes: a chevron on the name (assets), a
// chevron on the name again but in a card (agents), and a chevron plus the
// word "Edit" at the bottom of a card (flows, evals). Same gesture, three
// designs — so people learned it three times and it drifted every time one of
// them was touched.
//
// One component, one rule: **the name is the control.** Click it to open the
// editor underneath; a chevron says so. Nothing else is an edit affordance.

import type { ReactNode } from "react";

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-gray-300"
    >
      {open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

/**
 * A clickable title that opens an editor.
 *
 * @param subtitle description, shown under the name
 * @param meta     the file path, or anything else worth showing small
 * @param badges   rendered beside the name
 */
export function ExpandableTitle({
  open,
  onToggle,
  name,
  badges,
  subtitle,
  meta,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  badges?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? "Close the editor" : "Edit this file"}
      className="block w-full min-w-0 flex-1 text-left"
    >
      <span className="flex flex-wrap items-center gap-2">
        <Chevron open={open} />
        <span className="truncate text-sm font-semibold text-fg">{name}</span>
        {badges}
      </span>
      {subtitle && (
        <span className="mt-0.5 block truncate pl-5 text-sm text-fg-muted">{subtitle}</span>
      )}
      {meta && <span className="mt-1 block pl-5 font-mono text-xs text-fg-subtle">{meta}</span>}
    </button>
  );
}
