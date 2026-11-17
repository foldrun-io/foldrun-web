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

import { $t } from "@/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { cn } from "@foldrun/ui/react/cn";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Segmented } from "@foldrun/ui/react/segmented";
import { History } from "lucide-react";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { useCan, needs } from "@/components/role";
import { diffStats, foldDiff, lineDiff, restoreMessage, type DiffOp, type DiffRow } from "@/components/flow-history-model";
import { Tag } from "@foldrun/ui/react/page";
import { Sheet, SheetContent, SheetTitle } from "@foldrun/ui/react/dialog";

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
          <div key={i} className="select-none bg-sunken px-3 py-0.5 text-[11px] text-fg-subtle">
            {$t("components.flow-history.unchangedLine", { count: r.count })}
          </div>
        ) : (
          <div
            key={i}
            className={
              r.kind === "add" ? "bg-green-50 text-green-900" : r.kind === "del" ? "bg-red-50 text-red-900" : "text-fg-tertiary"
            }
          >
            <span className="inline-block w-8 select-none pr-1 text-right text-fg-subtle">{r.oldNo ?? ""}</span>
            <span className="inline-block w-8 select-none pr-1 text-right text-fg-subtle">{r.newNo ?? ""}</span>
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
      <Tooltip label={$t("components.flow-history.everySavedVersionOfFlows", { file: String(file) })}>
        <button type="button" onClick={() => setOpen(true)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <History aria-hidden />
          {$t("components.flow-history.history")}
        </button>
      </Tooltip>
      {open && <HistoryDrawer workspace={workspace} tenant={tenant} flow={flow} file={file} onClose={() => setOpen(false)} />}
    </>
  );
}

export function HistoryDrawer({
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
        if (typeof src.content !== "string") throw new Error(src.error ?? $t("components.flow-history.couldNotReadTheFlow"));
        setCurrent({ content: src.content, sha256: src.sha256 });
        const list = (hist.revisions ?? []) as Summary[];
        setRevisions(list);
        setSelected((s) => s ?? list[0]?.id ?? null);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : $t("components.flow-history.couldNotLoadHistory")));
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
      .catch(() => live && setError($t("components.flow-history.couldNotLoadThatRevision")));
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
      title: $t("components.flow-history.restoreTo", { flow: String(flow), label: String(label) }),
      body: (
        <>
          {$t("components.flow-history.flowsIsRewrittenWithThatVersion", { file: file, detail: restoreMessage(detail) })}
        </>
      ),
      confirmLabel: $t("components.flow-history.restoreThisVersion"),
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
          $t("components.flow-history.flowsChangedAfterThisDrawerOpened", { file: String(file) }),
        );
        return;
      }
      if (!res.ok) {
        setError(body.error ?? $t("components.flow-history.restoreRefused", { status: String(res.status) }));
        return;
      }
      const broken = (body.issues ?? []).filter((i) => i.level === "error");
      setNotice(
        $t("components.flow-history.restoredTheFlowNowReadsAs", { label: String(label) }) +
          (broken.length ? $t("components.flow-history.itDoesNotPassTodayS", { message: String(broken[0].message), v1: String(broken.length > 1 ? $t("components.flow-history.andMore", { v0: String(broken.length - 1) }) : "") }) : ""),
      );
      setSelected(null);
      setGeneration((g) => g + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : $t("components.flow-history.restoreFailed"));
    } finally {
      setBusy(false);
    }
  }, [detail, after, current, ask, flow, file, workspace, headers, path, router]);

  const stats = revFile ? diffStats(revFile.diff) : null;

  return (
    <>
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" hideClose aria-label={$t("components.flow-history.historyOf", { flow: String(flow) })} aria-describedby={undefined} className="w-full max-w-3xl">
        <SheetTitle className="sr-only">{$t("components.flow-history.historyOf", { flow: flow })}</SheetTitle>
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{$t("components.flow-history.history")}</h2>
            <p className="truncate font-mono text-[11px] text-fg-muted">{path}</p>
          </div>
          <button type="button" onClick={onClose} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")} aria-label={$t("components.flow-history.closeHistory")}>
            {$t("components.flow-history.close")}
          </button>
        </header>

        {error && (
          <p role="alert" className="border-b border-danger-line bg-danger-soft px-4 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {notice && <p className="border-b border-success-line bg-success-soft px-4 py-2 text-xs text-success">{notice}</p>}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul className="max-h-48 shrink-0 divide-y divide-line-faint overflow-y-auto border-b border-line-faint md:max-h-none md:w-64 md:border-b-0 md:border-r">
            {revisions === null && !error && <li className="px-3 py-2 text-xs text-fg-subtle">{$t("components.flow-history.loading")}</li>}
            {revisions?.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">{$t("components.flow-history.noRevisionsYetTheNextSave")}</li>
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
                  <span className="block truncate font-medium text-fg">{r.message || $t("components.flow-history.noMessage")}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
                    <span className="truncate">{r.by}</span>
                    <span>·</span>
                    <LocalTime iso={r.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    {i === 0 && <Tag className="ml-auto h-5 px-1.5 text-[11px]">{$t("components.flow-history.latest")}</Tag>}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="flex min-h-0 flex-1 flex-col">
            {selected && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line-faint px-3 py-2">
                <Segmented
                  role="tablist"
                  size="sm"
                  label={$t("components.flow-history.whatToCompare")}
                  value={mode}
                  onChange={(m) => setMode(m as typeof mode)}
                  items={[
                    { key: "change", label: $t("components.flow-history.whatItChanged") },
                    { key: "current", label: $t("components.flow-history.compareWithCurrent") },
                  ]}
                />
                {stats && mode === "change" && (
                  <span className="text-[11px] tabular-nums text-fg-muted">
                    <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
                  </span>
                )}
                {mode === "current" && <span className="text-[11px] text-fg-muted">{$t("components.flow-history.thisVersionTheFileNow")}</span>}
                <span className="ml-auto" />
                {after === null && revFile ? (
                  <span className="text-[11px] text-fg-muted">{$t("components.flow-history.thisRevisionDeletedTheFile")}</span>
                ) : isCurrent ? (
                  <span className="text-[11px] text-fg-muted">{$t("components.flow-history.thisIsWhatTheFileSays")}</span>
                ) : (
                  <Tooltip label={mayWrite ? undefined : needs("workspace:write")}>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={() => void restore()}
                        disabled={!mayWrite || busy || !revFile || !current}
                        className={buttonVariants({ variant: "secondary", size: "xs" })}
                      >
                        {busy ? "Restoring…" : $t("components.flow-history.restoreThisVersion")}
                      </button>
                    </span>
                  </Tooltip>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {selected && !revFile && !error && <p className="px-3 py-3 text-xs text-fg-subtle">{$t("components.flow-history.loading")}</p>}
              {revFile && (
                <DiffView
                  rows={rows}
                  empty={mode === "current" ? $t("components.flow-history.identicalToTheFileAsIt") : $t("components.flow-history.thisRevisionDidNotChangeThe")}
                />
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
    {dialog}
    </>
  );
}
