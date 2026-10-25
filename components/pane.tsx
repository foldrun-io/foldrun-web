// The workbench and its panes — one shape for every page that has a
// second column beside the main sidebar: the editor, storage, settings.
//
// A Workbench fills the viewport under the top bar. A Pane is a fixed-width
// column on its left or right, on the deeper paper, scrolling on its own,
// with an optional head and foot that stay put. Widths live here and only
// here: the editor's tree and the settings' section list used to be two
// different widths drawn by two different files.
//
// Under md there is no room for a column beside the page, so the workbench
// stacks: the left pane sits on top with a capped height and scrolls, and the
// page takes the width under it.

import type { ReactNode } from "react";

export const PANE_WIDTH = { left: "w-64", right: "w-72" } as const;

export function Workbench({ children }: { children: ReactNode }) {
  return <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col bg-surface md:flex-row">{children}</div>;
}

export function Pane({
  side,
  head,
  foot,
  children,
  className = "",
  onClickCapture,
}: {
  side: "left" | "right";
  /** Stays at the top while the body scrolls — a title, a filter box. */
  head?: ReactNode;
  /** Stays at the bottom — a drop zone, a note. */
  foot?: ReactNode;
  children: ReactNode;
  className?: string;
  onClickCapture?: (e: React.MouseEvent) => void;
}) {
  const edge = side === "left" ? "max-md:max-h-[35vh] max-md:w-full max-md:border-b md:border-r" : "border-l";
  return (
    <aside className={`flex ${PANE_WIDTH[side]} shrink-0 flex-col ${edge} border-line bg-paper-deep ${className}`} onClickCapture={onClickCapture}>
      {head && <div className="shrink-0 border-b border-line">{head}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {foot && <div className="shrink-0 border-t border-line">{foot}</div>}
    </aside>
  );
}

/** The main column between the panes: a head that stays, a body that scrolls. */
export function Stage({ head, children }: { head?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {head}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
