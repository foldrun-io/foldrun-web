"use client";

// The workspace's log, with diffs on demand.
//
// A revision row is a summary from the index; expanding one fetches the
// full revision and renders every file's diff. Fetched on expand rather than
// listed with content because a workspace's history is every save ever made
// and the page should open in the time it takes to read one line per row.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { buttonClass } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { DeployPreview } from "@/components/deploy-preview";

interface Summary {
  id: string;
  at: string;
  by: string;
  message: string;
  commit: string | null;
  paths: string[];
  /** Holds the whole tree, so it can be rolled back to. */
  restorable?: boolean;
}

interface Detail extends Summary {
  files: {
    path: string;
    before: string | null;
    after: string | null;
    diff: { kind: "same" | "add" | "del"; text: string }[];
  }[];
}

const shortId = (r: Summary) => (r.commit ? r.commit.slice(0, 7) : r.id.slice(0, 12));


/** Why a deploy did not happen, in the words the platform has for it. */
function refusal(d: { issues?: { where?: string; message: string }[]; blockedBy?: string[] }): string {
  if (d.blockedBy?.length) return `not deployed — ${d.blockedBy.length} run${d.blockedBy.length === 1 ? "" : "s"} still in flight (${d.blockedBy.join(", ")}); try again when they finish`;
  if (d.issues?.length) return `not deployed — ${d.issues.map((i) => (i.where ? `${i.where}: ` : "") + i.message).join("; ")}`;
  return "not deployed";
}

export function HistoryList({
  workspace,
  tenant,
  revisions,
}: {
  workspace: string;
  tenant: string;
  revisions: Summary[];
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail | "loading" | "error">>({});
  const [rolling, setRolling] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which revision's preview is open — what rolling back to it would change.
  const [previewing, setPreviewing] = useState<string | null>(null);
  // Make this revision live again: a restore to its snapshot, recorded as a
  // new revision — so the rollback is in the log, attributed, and itself
  // undoable. The same POST /restore the Backups page and the CLI use.
  const rollback = async (r: Summary) => {
    if (!(await confirm({ title: `Roll back to ${shortId(r)}?`, body: `The workspace becomes what it was at "${r.message}". Everything after it is kept in history, and runs, state and storage are not touched.`, confirmLabel: "Roll back", destructive: false }))) return;
    setRolling(r.id);
    setNote(null);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/restore`, { method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant }, body: JSON.stringify({ to: r.id, confirm: workspace }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      if (data.applied === false) setNote(refusal(data));
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setRolling(null);
    }
  };
  const editHref = (p: string) =>
    `/dashboard/${workspace}/edit?path=${encodeURIComponent(p)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`;

  const toggle = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (details[id]) return;
    setDetails((d) => ({ ...d, [id]: "loading" }));
    try {
      const res = await fetch(`/api/workspaces/${workspace}/history?id=${encodeURIComponent(id)}`, {
        headers: { "x-foldrun-tenant": tenant },
      });
      const data = (await res.json()) as Detail;
      setDetails((d) => ({ ...d, [id]: res.ok ? data : "error" }));
    } catch {
      setDetails((d) => ({ ...d, [id]: "error" }));
    }
  };

  return (
    <ul className="divide-y divide-line-faint">
      {confirmDialog}
      {note && <li className="px-5 py-2 text-xs text-red-600">{note}</li>}
      {revisions.map((r, index) => {
        const on = open === r.id;
        const detail = details[r.id];
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => void toggle(r.id)}
              className={`flex w-full items-start gap-4 px-5 py-3 text-left hover:bg-sunken ${on ? "bg-sunken" : ""}`}
            >
              <span className="w-24 shrink-0 pt-0.5 font-mono text-[11px] text-fg-subtle" title={r.id}>
                {shortId(r)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-fg">{r.message}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {r.by}
                  <span className="mx-1.5 text-gray-300">·</span>
                  <LocalTime iso={r.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                  {r.paths.length > 1 && (
                    <>
                      <span className="mx-1.5 text-gray-300">·</span>
                      {r.paths.length} files
                    </>
                  )}
                </span>
              </span>
              <span className="shrink-0 pt-1 text-xs text-gray-300">{on ? "▾" : "▸"}</span>
            </button>
            {on && r.restorable && index > 0 && (
              <div className="flex items-center gap-3 border-t border-line-faint bg-sunken px-5 py-2">
                <button type="button" onClick={() => setPreviewing(previewing === r.id ? null : r.id)} className={buttonClass("secondary", "px-2.5 py-1 text-xs")}>
                  {previewing === r.id ? "Hide preview" : "Preview"}
                </button>
                <button type="button" disabled={rolling !== null} onClick={() => void rollback(r)} className={buttonClass("secondary", "px-2.5 py-1 text-xs")}>
                  {rolling === r.id ? "Rolling back…" : "Roll back to this"}
                </button>
                <span className="text-[11px] text-fg-subtle">Makes main what it was here. Later changes stay in history.</span>
              </div>
            )}
            {on && r.restorable && index > 0 && previewing === r.id && (
              <div className="border-t border-line-faint bg-sunken px-5 py-3">
                <DeployPreview workspace={workspace} tenant={tenant} to={r.id} />
              </div>
            )}

            {on && (
              <div className="border-t border-line-faint bg-surface px-5 py-3">
                {detail === "loading" || !detail ? (
                  <p className="text-xs text-fg-subtle">Loading…</p>
                ) : detail === "error" ? (
                  <p className="text-xs text-red-600">Could not load this revision.</p>
                ) : (
                  <div className="space-y-4">
                    {detail.files.map((f) => (
                      <div key={f.path}>
                        <div className="mb-1 flex items-baseline justify-between">
                          <Link href={editHref(f.path)} className="font-mono text-xs font-medium text-fg hover:underline">
                            {f.path}
                          </Link>
                          <span className="text-[11px] text-fg-subtle">
                            {f.before === null ? "created" : f.after === null ? "deleted" : "edited"}
                          </span>
                        </div>
                        <pre className="max-h-80 overflow-auto rounded-md border border-line font-mono text-[11px] leading-relaxed">
                          {f.diff
                            // A long unchanged run is noise; keep three lines of context around a change.
                            .map((op, i, all) => ({ op, i, keep: op.kind !== "same" || all.slice(Math.max(0, i - 3), i + 4).some((o) => o.kind !== "same") }))
                            .reduce<{ rows: React.ReactNode[]; gap: boolean }>(
                              (acc, { op, i, keep }) => {
                                if (!keep) {
                                  if (!acc.gap) acc.rows.push(<div key={`gap-${i}`} className="px-3 text-gray-300">⋯</div>);
                                  return { rows: acc.rows, gap: true };
                                }
                                acc.rows.push(
                                  <div
                                    key={i}
                                    className={`px-3 ${op.kind === "add" ? "bg-green-50 text-green-800" : op.kind === "del" ? "bg-red-50 text-red-800" : "text-fg-muted"}`}
                                  >
                                    <span className="mr-2 inline-block w-3 select-none text-gray-300">
                                      {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
                                    </span>
                                    {op.text || " "}
                                  </div>,
                                );
                                return { rows: acc.rows, gap: false };
                              },
                              { rows: [], gap: false },
                            ).rows}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
