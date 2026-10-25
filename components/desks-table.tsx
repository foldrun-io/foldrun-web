"use client";

// Every workspace, once: its last runs as a strip, how its newest run went,
// when it next fires, and the week's runs and spend. Replaces the Desks
// heartbeat table and the Workspaces cards, which listed the same desks one
// above the other. The server builds the rows (desks-model.ts); this
// searches and orders them.

import { creditsShort } from "@/components/money";
import type { Tally } from "@/components/outcome-model";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { OUTCOME } from "./outcome-model";
import { fmtSpan } from "./mission-model";
import { filterDesks, type DeskRow, type DeskSort } from "./desks-model";
import { fmtIn } from "./workspace-overview-model";
import { Cells, CellLegend, Panel } from "./mission-control";
import { runHref } from "./run-href";
import { buttonClass, selectClass } from "./ui";
import { useCan } from "./role";
import { Avatar } from "./avatar";

const STRIP = 20;

export function DesksTable({ rows, tenant, now }: { rows: DeskRow[]; tenant: string; now: number }) {
  const canWrite = useCan("workspace:write");
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<DeskSort>("activity");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" puts the cursor in the search box from anywhere not already a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const shown = filterDesks(rows, q, sort);
  const addNew = [
    { name: "Workspace", hint: "Its own agents, flows, secrets and runs", href: `/dashboard?create=workspace${rest}` },
    { name: "Import workspace", hint: "From a .zip that Export made, here or in another account", href: `/dashboard?import=workspace${rest}` },
    { name: "Shared tool", hint: "A tool every workspace can grant", href: `/dashboard/library?kind=tools${rest}` },
    { name: "Shared skill", hint: "A skill every agent can load", href: `/dashboard/library?kind=skills${rest}` },
    { name: "Shared knowledge", hint: "Reference every workspace reads", href: `/dashboard/library?kind=knowledge${rest}` },
  ];

  return (
    <Panel title="Desks" count={q ? shown.length : rows.length} action={<CellLegend />}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-faint px-4 py-2.5">
        <label className="relative min-w-[14rem] flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-subtle">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQ("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search desks…"
            aria-label="Search desks"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-8 text-sm text-fg placeholder:text-fg-subtle focus:border-gray-400 focus:outline-none"
          />
          <kbd className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[10px] text-fg-subtle">/</kbd>
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as DeskSort)} aria-label="Sort" className={selectClass("h-8 text-xs")}>
          <option value="activity">Needs looking at first</option>
          <option value="name">By name</option>
          <option value="spend">By 7d spend</option>
        </select>
        {canWrite && (
          <div ref={menuRef} className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className={buttonClass("primary", "h-8")}>
              Add New
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl">
                {addNew.map((it) => (
                  <Link key={it.name} role="menuitem" href={it.href} onClick={() => setMenu(false)} className="block px-3 py-2 hover:bg-sunken">
                    <span className="block text-sm font-medium text-fg">{it.name}</span>
                    <span className="block text-xs text-fg-muted">{it.hint}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-fg-subtle">
          {rows.length === 0 ? "No workspaces yet — Add New, or deploy one from the CLI." : `Nothing matches “${q}”.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2 font-medium">Desk</th>
                <th className="px-2 py-2 font-medium">Last {STRIP} runs</th>
                <th className="px-2 py-2 font-medium">Latest</th>
                <th className="px-2 py-2 font-medium">Next</th>
                <th className="px-2 py-2 text-right font-medium" title="Of the last runs: how many ran to the end without failing, of completed + failed (stopped left out) — and what went wrong">Completed</th>
                <th className="px-4 py-2 text-right font-medium" title="Credits charged in the last 7 days (list price for runs not settled yet)">7d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {shown.map((d) => {
                const h = d.beat;
                return (
                  <tr key={d.name} className="hover:bg-sunken/60">
                    <td className="max-w-[16rem] px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={d.name} src={d.avatar} size="sm" square />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Link href={`/dashboard/${d.name}${qs}`} className="truncate font-medium text-fg hover:underline">{d.name}</Link>
                            {h.live > 0 && (
                              <Link
                                href={d.liveRunId ? runHref(d.name, d.liveRunId, tenant) : `/dashboard/${d.name}/runs${qs}`}
                                title="Watch it run"
                                className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-sky-700 hover:underline"
                              >
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />{h.live} live
                              </Link>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-fg-subtle">
                            {d.description || `${d.agents} agents · ${d.flows} flows`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2"><Cells beat={h} n={STRIP} tenant={tenant} /></td>
                    <td className="max-w-[22rem] px-2 py-2">
                      {h.last ? (
                        <Link href={runHref(h.last.workspace, h.last.id, tenant)} className="group flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME[h.last.outcome].dot}`} />
                          <span className="truncate text-xs text-fg-tertiary group-hover:text-fg group-hover:underline" title={h.last.headline ?? h.last.what}>
                            {h.last.failure ? `${h.last.failure.agent}: ${h.last.failure.reason}` : h.last.headline ?? h.last.what}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-subtle">{fmtSpan(now - Date.parse(h.last.startedAt))}</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-fg-subtle">no runs yet</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {d.next ? (
                        <Link href={`/dashboard/${d.name}/flows?flow=${encodeURIComponent(d.next.flow)}${rest}`} className="text-fg-tertiary hover:text-fg hover:underline" title={d.next.at}>
                          {d.next.flow} <span className="tabular-nums text-fg-subtle">{fmtIn(Math.max(0, Date.parse(d.next.at) - now))}</span>
                        </Link>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      <Counts t={h.tally} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-xs tabular-nums text-fg-tertiary">
                      {h.spend7dUsd ? creditsShort(h.spend7dUsd) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Counts, not a percentage (FOL-54): "20/22 · 2 failed · 1 blocked". */
function Counts({ t }: { t: Tally }) {
  if (!t.finished) return <span className="text-gray-300">—</span>;
  const wrong = [
    t.failed ? { n: t.failed, word: "failed", tone: "text-red-700" } : null,
    t.blocked ? { n: t.blocked, word: "blocked", tone: "text-red-700" } : null,
    t.bad ? { n: t.bad, word: "problem found", tone: "text-amber-700" } : null,
  ].filter((x) => x !== null);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={`${t.completed} of ${t.finished} ran to the end without failing${t.stopped ? ` · ${t.stopped} stopped (left out)` : ""}${t.quiet ? ` · ${t.quiet} had nothing to do` : ""}`}>
      <span className={wrong.length ? "text-fg" : "text-emerald-700"}>{t.completed}/{t.finished}</span>
      {wrong.map((w) => (
        <span key={w.word} className={w.tone}>· {w.n} {w.word}</span>
      ))}
    </span>
  );
}
