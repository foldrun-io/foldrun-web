"use client";

// What this file used to say.
//
// Every save records a revision (core/src/history.ts); this shows them for
// one file: who changed it, when, and the diff. "Use this version" loads an
// older text into the editor as an unsaved change — it does not write
// anything itself. Restoring goes through the same Save as every other edit,
// so it is a revision like the rest, attributed to whoever pressed the button,
// and it can itself be undone.

import { useEffect, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { buttonClass } from "@/components/ui";
import { usePaged, PagerControls } from "@/components/pager";

interface Summary {
  id: string;
  at: string;
  by: string;
  message: string;
  commit: string | null;
}

interface Detail extends Summary {
  files: {
    path: string;
    before: string | null;
    after: string | null;
    diff: { kind: "same" | "add" | "del"; text: string }[];
  }[];
}

export function HistoryPanel({
  workspace,
  tenant,
  path,
  onUse,
}: {
  workspace: string;
  tenant: string;
  path: string;
  /** Load a past version into the editor, unsaved. */
  onUse: (content: string) => void;
}) {
  const [revisions, setRevisions] = useState<Summary[] | null>(null);
  // Before the early returns: a hook has one order.
  const paged = usePaged(revisions ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = { "x-foldrun-tenant": tenant };

  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/${workspace}/history?path=${encodeURIComponent(path)}`, { headers })
      .then((r) => r.json())
      .then((d) => live && setRevisions(d.revisions ?? []))
      .catch(() => live && setError("could not load history"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, tenant, path]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    let live = true;
    fetch(`/api/workspaces/${workspace}/history?id=${encodeURIComponent(open)}&path=${encodeURIComponent(path)}`, { headers })
      .then((r) => r.json())
      .then((d) => live && setDetail(d))
      .catch(() => live && setError("could not load that revision"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace, tenant, path]);

  if (error) return <p className="mt-2 text-xs text-red-600">{error}</p>;
  if (revisions === null) return <p className="mt-2 text-xs text-fg-subtle">Loading history…</p>;
  if (revisions.length === 0) {
    return (
      <p className="mt-2 text-xs text-fg-subtle">
        No history yet — the first save from now on starts it.
      </p>
    );
  }

  const file = detail?.files[0];

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface">
      <ul className="max-h-48 divide-y divide-gray-50 overflow-y-auto">
        {paged.rows.map((r) => {
          const on = open === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(on ? null : r.id)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-sunken ${on ? "bg-sunken" : ""}`}
              >
                <span className="min-w-0 truncate text-fg">
                  {r.message}
                  <span className="ml-2 text-fg-subtle">{r.by}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                  {r.commit ? r.commit.slice(0, 7) : r.id.slice(0, 12)}
                  <span className="ml-2 font-sans">
                    <LocalTime iso={r.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-2 pb-2">
        <PagerControls page={paged.page} pages={paged.pages} onPage={paged.setPage} labels={["← Newer", "Older →"]} />
      </div>

      {open && (
        <div className="border-t border-line-faint">
          {!file ? (
            <p className="px-3 py-2 text-xs text-fg-subtle">Loading…</p>
          ) : (
            <>
              <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
                {file.diff.map((op, i) => (
                  <div
                    key={i}
                    className={
                      op.kind === "add"
                        ? "bg-green-50 text-green-800"
                        : op.kind === "del"
                          ? "bg-red-50 text-red-800 line-through decoration-red-300"
                          : "text-fg-muted"
                    }
                  >
                    <span className="mr-2 inline-block w-3 select-none text-gray-300">
                      {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
                    </span>
                    {op.text || " "}
                  </div>
                ))}
              </pre>
              <div className="flex items-center gap-2 border-t border-line-faint px-3 py-2">
                {file.after !== null ? (
                  <button
                    type="button"
                    onClick={() => onUse(file.after!)}
                    className={buttonClass("secondary", "px-2 py-0.5 text-xs")}
                  >
                    Use this version
                  </button>
                ) : (
                  <span className="text-xs text-fg-subtle">This revision deleted the file.</span>
                )}
                {file.before !== null && file.after !== null && (
                  <button
                    type="button"
                    onClick={() => onUse(file.before!)}
                    className={buttonClass("minimal", "px-2 py-0.5 text-xs")}
                    title="What the file said before this change"
                  >
                    Use the version before it
                  </button>
                )}
                <span className="ml-auto text-[11px] text-fg-subtle">
                  Loads into the editor — nothing changes until you save.
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
