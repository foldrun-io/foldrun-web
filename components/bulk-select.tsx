"use client";

// Checkbox selection with bulk actions, for any table in the dashboard.
//
// Three client pieces share one selection through context, so the table
// itself can stay a server component: the page wraps its list in a
// `SelectionProvider` with the ids on this page, puts a `SelectAllCheckbox`
// in the header and a `RowCheckbox` in each row, and mounts a `BulkActionBar`
// with the actions that make sense for that list. The bar appears the moment
// something is ticked and runs an action over every selected id (one request
// each, or one call for all of them where the API has a bulk route),
// reporting progress and whatever refused — then refreshes the page, which
// is how a server-rendered list learns what changed.
//
// Selection is per page of results and never survives navigation: a "select
// all" that quietly meant every row on every page is how people delete the
// wrong thousand things.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm";
import { buttonClass } from "@/components/ui";

interface Selection {
  ids: string[];
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  enabled: boolean;
}

const Ctx = createContext<Selection | null>(null);

export function SelectionProvider({
  ids,
  enabled = true,
  children,
}: {
  /** The ids of the rows on this page, in table order. */
  ids: string[];
  /** False hides every checkbox — for a reader with nothing to act on. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const [ticked, setSelected] = useState<Set<string>>(() => new Set());
  // The page turns or a filter changes: whatever was ticked is not on screen
  // any more, so it is not selected any more. Read as the intersection with
  // the rows actually shown, rather than reset in an effect — a stale tick
  // then simply stops counting the moment its row is gone.
  const selected = useMemo(() => {
    const shown = new Set(ids);
    return new Set([...ticked].filter((id) => shown.has(id)));
  }, [ids, ticked]);

  const value = useMemo<Selection>(
    () => ({
      ids,
      selected,
      enabled,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
      clear: () => setSelected(new Set()),
    }),
    [ids, selected, enabled],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelection needs a SelectionProvider above it");
  return ctx;
}

const BOX = "h-3.5 w-3.5 cursor-pointer rounded border-line-strong text-fg focus:ring-gray-400";

export function SelectAllCheckbox({ label = "Select all on this page" }: { label?: string }) {
  const { ids, selected, setAll, enabled } = useSelection();
  const ref = useRef<HTMLInputElement>(null);
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = !all && ids.some((id) => selected.has(id));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  if (!enabled) return null;
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={all}
      onChange={(e) => setAll(e.target.checked)}
      className={BOX}
    />
  );
}

export function RowCheckbox({ id, label }: { id: string; label?: string }) {
  const { selected, toggle, enabled } = useSelection();
  if (!enabled) return null;
  return (
    <input
      type="checkbox"
      aria-label={label ?? `Select ${id}`}
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      className={BOX}
    />
  );
}

export interface BulkAction {
  /** The verb on the button: "Delete", "Stop", "Archive". */
  label: string;
  tone?: "default" | "destructive";
  /** Which of the selected ids this action applies to. Default: all of them.
   *  An action that applies to none of the selection is not offered. */
  applies?: (id: string) => boolean;
  /** The confirmation, given how many it will touch. Undefined: no dialog. */
  confirm?: (count: number) => { title: string; body?: ReactNode; confirmLabel?: string };
  /** One id. Throw to report a refusal; the bar keeps going. */
  perform?: (id: string) => Promise<void>;
  /** Every applicable id in one go, for a list whose API has a bulk route.
   *  Resolves to the refusals, one line each; a throw refuses them all.
   *  Used in place of `perform` when both are given. */
  performAll?: (ids: string[]) => Promise<string[]>;
}

export function BulkActionBar({ actions, noun = "items" }: { actions: BulkAction[]; noun?: string }) {
  const { selected, clear, enabled } = useSelection();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<{ label: string; done: number; of: number } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  if (!enabled) return null;
  const chosen = [...selected];
  if (chosen.length === 0 && failed.length === 0) return null;

  const run = async (a: BulkAction) => {
    const targets = a.applies ? chosen.filter(a.applies) : chosen;
    if (targets.length === 0) return;
    if (a.confirm) {
      const c = a.confirm(targets.length);
      if (!(await confirm({ ...c, confirmLabel: c.confirmLabel ?? a.label }))) return;
    }
    setFailed([]);
    setBusy({ label: a.label, done: 0, of: targets.length });
    const refused: string[] = [];
    if (a.performAll) {
      try {
        refused.push(...(await a.performAll(targets)));
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        refused.push(...targets.map((id) => `${id}: ${why}`));
      }
      setBusy({ label: a.label, done: targets.length, of: targets.length });
    } else if (a.perform) {
      for (const [i, id] of targets.entries()) {
        try {
          await a.perform(id);
        } catch (err) {
          refused.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
        setBusy({ label: a.label, done: i + 1, of: targets.length });
      }
    }
    setBusy(null);
    setFailed(refused);
    clear();
    router.refresh();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs">
      {confirmDialog}
      {busy ? (
        <span className="tabular-nums text-fg-tertiary">
          {busy.label}… {busy.done} of {busy.of}
        </span>
      ) : chosen.length > 0 ? (
        <>
          <span className="font-medium tabular-nums text-fg">
            {chosen.length} {noun} selected
          </span>
          <span className="mx-1 h-4 w-px bg-muted-strong" />
          {actions
            .filter((a) => (a.applies ? chosen.some(a.applies) : true))
            .map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => void run(a)}
                className={buttonClass(a.tone === "destructive" ? "destructive" : "secondary", "!px-2.5 !py-1 !text-xs")}
              >
                {a.label}
                {a.applies && (
                  <span className="tabular-nums text-fg-subtle">{chosen.filter(a.applies).length}</span>
                )}
              </button>
            ))}
          <button type="button" onClick={clear} className="ml-auto font-medium text-fg-muted hover:text-fg">
            Clear
          </button>
        </>
      ) : null}
      {failed.length > 0 && !busy && (
        <div className="basis-full text-red-700">
          {failed.length} refused:
          <ul className="mt-0.5 list-inside list-disc font-mono text-[11px]">
            {failed.slice(0, 5).map((f) => (
              <li key={f}>{f}</li>
            ))}
            {failed.length > 5 && <li>…and {failed.length - 5} more</li>}
          </ul>
          <button type="button" onClick={() => setFailed([])} className="mt-1 font-medium underline-offset-2 hover:underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
