"use client";

// The overview layout, cloudhost's team overview: one search field across
// the top (with the cards/table switch), then two columns — the narrow one
// for what needs a person (usage, attention, what is next), the wide one for
// the things themselves as cards (or a table). The search filters the wide
// column. The page draws the left column and every card on the server.

import { useState, type ReactNode } from "react";
import { cn } from "./cn";
import { RowTable, SearchField, ViewToggle, type Column, type Row, type View } from "./list";
import { CardGrid, EmptyState, SectionTitle } from "./page";

export function SplitOverview({
  search,
  rows,
  columns,
  left,
  title,
  actions,
  empty,
  toolbar,
  defaultView = "grid",
  after,
}: {
  search: string;
  rows: Row[];
  columns: Column[];
  /** The narrow column, drawn by the page. */
  left?: ReactNode;
  /** The wide column's heading. */
  title: ReactNode;
  /** Beside the wide column's heading. */
  actions?: ReactNode;
  /** When there is nothing at all. */
  empty?: ReactNode;
  /** Beside the search field. */
  toolbar?: ReactNode;
  defaultView?: View;
  /** Under the wide column's list (a second list). */
  after?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>(defaultView);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.search.toLowerCase().includes(needle)) : rows;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder={search} className="min-w-48 flex-1" />
        <ViewToggle value={view} onChange={setView} />
        {toolbar}
      </div>
      <div className={cn("grid gap-8", left && "lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]")}>
        {left && <div className="order-2 min-w-0 space-y-8 lg:order-1">{left}</div>}
        <div className="order-1 min-w-0 lg:order-2">
          <SectionTitle title={title} actions={actions} />
          {!rows.length && empty ? (
            empty
          ) : !shown.length ? (
            <EmptyState title="Nothing matches." compact />
          ) : view === "grid" ? (
            <CardGrid>
              {shown.map((r) => (
                <div key={r.key} className="min-w-0">
                  {r.card}
                </div>
              ))}
            </CardGrid>
          ) : (
            <RowTable columns={columns} rows={shown} />
          )}
          {after && <div className="mt-10 space-y-8">{after}</div>}
        </div>
      </div>
    </div>
  );
}
