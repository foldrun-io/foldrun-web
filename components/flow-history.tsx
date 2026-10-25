"use client";

// Version history for one flow file, in a drawer on the flow's card.
//
// The markdown is the flow, so its history is the flow's history: every
// save, canvas edit, deploy and restore is a revision of flows/<file>. This
// lists them (who, when, why), shows what one changed, compares it with the
// file as it is now, and restores it — by writing that revision's bytes back
// through the same source PUT every edit uses, so the restore is itself a
// revision, attributed and undoable.
//
// The restore carries the sha256 the drawer read when it opened. If the file
// changed since (a canvas edit in another tab, a deploy), the server refuses
// with 409 and nothing is written — a restore must never quietly undo a
// change nobody in this drawer has seen.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { buttonClass } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useCan, needs } from "@/components/role";
import { diffStats, foldDiff, lineDiff, restoreMessage, type DiffOp, type DiffRow } from "@/components/flow-history-model";

interface Summary {
  id: string;
  at: string;
  by: string;
  message: string;
  commit: string | null;
}

interface Detail extends Summary {
  /** The id this detail was fetched for — the list's, whatever the server
   *  calls it — so a slow answer for another row is never shown. */
  requested?: string | null;
  files: { path: string; before: string | null; after: string | null; diff: DiffOp[] }[];
}

export function DiffView({ rows, empty }: { rows: DiffRow[]; empty: string }) {
  if (rows.length === 0) return <p className="px-3 py-3 text-xs text-fg-subtle">{empty}</p>;
  return (
    <pre className="overflow-auto py-1 font-mono text-[11px] leading-relaxed" data-testid="diff">
      {rows.map((r, i) =>
        r.kind === "gap" ? (
          <div key={i} className="select-none bg-sunken px-3 py-0.5 text-[10px] text-fg-subtle">
            ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
          </div>
        ) : (
          <div
            key={i}
            className={
              r.kind === "add" ? "bg-green-50 text-green-900" : r.kind === "del" ? "bg-red-50 text-red-900" : "text-fg-tertiary"
            }
          >
            <span className="inline-block w-8 select-none pr-1 text-right text-gray-300">{r.oldNo ?? ""}</span>
            <span className="inline-block w-8 select-none pr-1 text-right text-gray-300">{r.newNo ?? ""}</span>
            <span className="mr-2 inline-block w-3 select-none text-fg-subtle">
              {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}
            </span>
            {r.text || " "}
          </div>
        ),
      )}
    </pre>
  );
}

export function FlowHistory({ workspace, tenant, flow, file }: { workspace: string; tenant: string; flow: string; file: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("minimal", "px-2 py-1 text-xs")} title={`Every saved version of flows/${file}`}>
        History
      </button>
      {open && <HistoryDrawer workspace={workspace} tenant={tenant} flow={flow} file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

function HistoryDrawer({
  workspace,
  tenant,
  flow,
  file,
  onClose,
}: {
  workspace: string;
  tenant: string;
  flow: string;
  file: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const path = `flows/${file}`;
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant }), [tenant]);
  const mayWrite = useCan("workspace:write");
  const [ask, dialog] = useConfirm();

  // What the file says now, and the sha the restore will hold the server to.
  const [current, setCurrent] = useState<{ content: string; sha256: string } | null>(null);
  const [revisions, setRevisions] = useState<Summary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mode, setMode] = useState<"change" | "current">("change");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // Escape closes the drawer — unless a confirmation is up, which Escape
    // answers on its own.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="alertdialog"]') && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // One load per open and per restore: the file and its revisions together,
  // so the sha and the list describe the same moment.
  useEffect(() => {
    let live = true;
    const q = encodeURIComponent(path);
    Promise.all([
      fetch(`/api/workspaces/${workspace}/source?path=${q}`, { headers }).then((r) => r.json()),
      fetch(`/api/workspaces/${workspace}/history?path=${q}&limit=200`, { headers }).then((r) => r.json()),
    ])
      .then(([src, hist]) => {
        if (!live) return;
        if (typeof src.content !== "string") throw new Error(src.error ?? "could not read the flow");
        setCurrent({ content: src.content, sha256: src.sha256 });
        const list = (hist.revisions ?? []) as Summary[];
        setRevisions(list);
        setSelected((s) => s ?? list[0]?.id ?? null);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "could not load history"));
    return () => {
      live = false;
    };
  }, [workspace, path, headers, generation]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    fetch(`/api/workspaces/${workspace}/history?id=${encodeURIComponent(selected)}&path=${encodeURIComponent(path)}`, { headers })
      .then((r) => r.json())
      .then((d) => live && setDetail({ ...d, requested: selected }))
      .catch(() => live && setError("could not load that revision"));
    return () => {
      live = false;
    };
  }, [selected, workspace, path, headers]);

  // A detail for another revision is still on its way out: show none.
  const revFile = (detail?.requested === selected ? detail?.files[0] : null) ?? null;
  const after = revFile?.after ?? null;
  const isCurrent = after !== null && current !== null && after === current.content;

  const rows = useMemo(() => {
    if (!revFile) return [];
    if (mode === "change") return foldDiff(revFile.diff);
    return foldDiff(lineDiff(revFile.after ?? "", current?.content ?? ""));
  }, [revFile, mode, current]);

  const restore = useCallback(async () => {
    if (!detail || after === null || !current) return;
    const label = detail.commit ? detail.commit.slice(0, 7) : detail.id;
    const ok = await ask({
      title: `Restore ${flow} to ${label}?`,
      body: (
        <>
          flows/{file} is rewritten with that version&apos;s text, as a new revision named
          &ldquo;{restoreMessage(detail)}&rdquo;. What it says now stays in this history and can be restored back.
        </>
      ),
      confirmLabel: "Restore this version",
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/source`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        // A restore is an exact version someone picked: saved unchecked, and
        // it says so when today's checks would refuse it (FOL-57).
        body: JSON.stringify({ path, content: after, message: restoreMessage(detail), ifMatch: current.sha256 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { level: string; message: string }[] };
      if (res.status === 409) {
        setError(
          `flows/${file} changed after this drawer opened, so nothing was restored. Close and reopen History to see the newer version, then restore again if you still want to.`,
        );
        return;
      }
      if (!res.ok) {
        setError(body.error ?? `restore refused (${res.status})`);
        return;
      }
      const broken = (body.issues ?? []).filter((i) => i.level === "error");
      setNotice(
        `Restored ${label}. The flow now reads as it did then.` +
          (broken.length ? ` It does not pass today's checks: ${broken[0].message}${broken.length > 1 ? ` (and ${broken.length - 1} more)` : ""}.` : ""),
      );
      setSelected(null);
      setGeneration((g) => g + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "restore failed");
    } finally {
      setBusy(false);
    }
  }, [detail, after, current, ask, flow, file, workspace, headers, path, router]);

  const stats = revFile ? diffStats(revFile.diff) : null;

  return (
    <>
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-label={`History of ${flow}`}
        className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">History</h2>
            <p className="truncate font-mono text-[11px] text-fg-muted">{path}</p>
          </div>
          <button type="button" onClick={onClose} className={buttonClass("minimal", "ml-auto px-2 py-1 text-xs")} aria-label="Close history">
            Close
          </button>
        </header>

        {error && (
          <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {notice && <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">{notice}</p>}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul className="max-h-48 shrink-0 divide-y divide-line-faint overflow-y-auto border-b border-line-faint md:max-h-none md:w-64 md:border-b-0 md:border-r">
            {revisions === null && !error && <li className="px-3 py-2 text-xs text-fg-subtle">Loading…</li>}
            {revisions?.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">No revisions yet — the next save of this flow starts its history.</li>
            )}
            {revisions?.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(r.id);
                    setNotice(null);
                  }}
                  aria-current={selected === r.id}
                  className={`block w-full px-3 py-2 text-left text-xs hover:bg-sunken ${selected === r.id ? "bg-muted" : ""}`}
                >
                  <span className="block truncate font-medium text-fg">{r.message || "(no message)"}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
                    <span className="truncate">{r.by}</span>
                    <span>·</span>
                    <LocalTime iso={r.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    {i === 0 && <span className="ml-auto rounded bg-muted-strong px-1 text-[10px] text-fg-secondary">latest</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="flex min-h-0 flex-1 flex-col">
            {selected && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line-faint px-3 py-2">
                <div role="tablist" className="inline-flex gap-1 rounded-lg border border-line p-0.5">
                  {(
                    [
                      ["change", "What it changed"],
                      ["current", "Compare with current"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${mode === m ? "bg-ink text-on-ink" : "text-fg-tertiary hover:bg-muted"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {stats && mode === "change" && (
                  <span className="text-[11px] tabular-nums text-fg-muted">
                    <span className="text-green-700">+{stats.added}</span> <span className="text-red-700">−{stats.removed}</span>
                  </span>
                )}
                {mode === "current" && <span className="text-[11px] text-fg-muted">− this version · + the file now</span>}
                <span className="ml-auto" />
                {after === null && revFile ? (
                  <span className="text-[11px] text-fg-muted">This revision deleted the file.</span>
                ) : isCurrent ? (
                  <span className="text-[11px] text-fg-muted">This is what the file says now.</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void restore()}
                    disabled={!mayWrite || busy || !revFile || !current}
                    title={mayWrite ? undefined : needs("workspace:write")}
                    className={buttonClass("secondary", "px-2 py-1 text-xs")}
                  >
                    {busy ? "Restoring…" : "Restore this version"}
                  </button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {selected && !revFile && !error && <p className="px-3 py-3 text-xs text-fg-subtle">Loading…</p>}
              {revFile && (
                <DiffView
                  rows={rows}
                  empty={mode === "current" ? "Identical to the file as it is now." : "This revision did not change the text."}
                />
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
    {dialog}
    </>
  );
}
