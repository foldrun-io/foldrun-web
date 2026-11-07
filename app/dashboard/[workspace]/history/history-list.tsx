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
import { useConfirm } from "@/components/kit/confirm";
import { DeployPreview } from "@/components/deploy-preview";
import { WithEmails } from "@/components/email";
import { ChevronRight, Eye, EyeOff, GitCommitHorizontal, RotateCcw } from "lucide-react";
import { Button } from "@/components/kit/button";
import { Chip, IconBox, Callout } from "@/components/kit/page";
import { cn } from "@/components/kit/cn";
import { Tooltip } from "@/components/kit/tooltip";

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
  page = 1,
}: {
  workspace: string;
  tenant: string;
  revisions: Summary[];
  /** Which page of the log this is: the first row of page 1 is what is live. */
  page?: number;
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
    <div className="min-w-0 space-y-3">
      {confirmDialog}
      {note && <Callout tone="danger" className="px-4 py-2.5 text-sm" role="alert">{note}</Callout>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {revisions.map((r, index) => {
          const on = open === r.id;
          const detail = details[r.id];
          const canRoll = r.restorable && index > 0;
          return (
            <li key={r.id}>
              <div className={cn("relative flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-sunken sm:px-4", on && "bg-sunken")}>
                <IconBox>
                  <GitCommitHorizontal aria-hidden />
                </IconBox>
                <button
                  type="button"
                  onClick={() => void toggle(r.id)}
                  aria-expanded={on}
                  className="min-w-0 flex-1 text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{r.message}</span>
                    {page === 1 && index === 0 && <Chip tone="good" dot>Live</Chip>}
                  </span>
                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                    <Tooltip label={r.id}>
                      <span className="font-mono text-fg-secondary">
                        {shortId(r)}
                      </span>
                    </Tooltip>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate">
                      <WithEmails text={r.by} />
                    </span>
                    <span aria-hidden>·</span>
                    <LocalTime iso={r.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    {r.paths.length > 1 && (
                      <>
                        <span aria-hidden>·</span>
                        {r.paths.length} files
                      </>
                    )}
                  </span>
                </button>
                {canRoll && (
                  <Button size="sm" className="relative z-10 max-sm:hidden" disabled={rolling !== null} onClick={() => void rollback(r)}>
                    <RotateCcw aria-hidden />
                    {rolling === r.id ? "Rolling back…" : "Roll back"}
                  </Button>
                )}
                <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-fg-subtle transition-transform", on && "rotate-90")} />
              </div>

              {on && canRoll && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line-faint bg-sunken px-3 py-2.5 sm:px-4">
                  <Button size="sm" onClick={() => setPreviewing(previewing === r.id ? null : r.id)}>
                    {previewing === r.id ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    {previewing === r.id ? "Hide preview" : "Preview"}
                  </Button>
                  <Button size="sm" className="sm:hidden" disabled={rolling !== null} onClick={() => void rollback(r)}>
                    <RotateCcw aria-hidden />
                    {rolling === r.id ? "Rolling back…" : "Roll back to this"}
                  </Button>
                  <span className="text-[13px] text-fg-muted">Makes main what it was here. Later changes stay in history.</span>
                </div>
              )}
              {on && canRoll && previewing === r.id && (
                <div className="border-t border-line-faint bg-sunken px-3 py-3 sm:px-4">
                  <DeployPreview workspace={workspace} tenant={tenant} to={r.id} />
                </div>
              )}

              {on && (
                <div className="border-t border-line-faint bg-surface px-3 py-3 sm:px-4">
                  {detail === "loading" || !detail ? (
                    <p className="text-[13px] text-fg-muted">Loading…</p>
                  ) : detail === "error" ? (
                    <p className="text-[13px] text-danger">Could not load this revision.</p>
                  ) : (
                    <div className="space-y-4">
                      {detail.files.map((f) => (
                        <div key={f.path} className="min-w-0">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <Link href={editHref(f.path)} className="min-w-0 truncate font-mono text-xs font-medium text-fg hover:underline">
                              {f.path}
                            </Link>
                            <Chip tone={f.before === null ? "good" : f.after === null ? "bad" : "default"}>{f.before === null ? "created" : f.after === null ? "deleted" : "edited"}</Chip>
                          </div>
                          <pre className="max-h-80 overflow-auto rounded-md border border-line bg-sunken py-1 font-mono text-[11px] leading-relaxed">
                            {f.diff
                              // A long unchanged run is noise; keep three lines of context around a change.
                              .map((op, i, all) => ({ op, i, keep: op.kind !== "same" || all.slice(Math.max(0, i - 3), i + 4).some((o) => o.kind !== "same") }))
                              .reduce<{ rows: React.ReactNode[]; gap: boolean }>(
                                (acc, { op, i, keep }) => {
                                  if (!keep) {
                                    if (!acc.gap) acc.rows.push(<div key={`gap-${i}`} className="px-3 text-fg-subtle">⋯</div>);
                                    return { rows: acc.rows, gap: true };
                                  }
                                  acc.rows.push(
                                    <div key={i} className={`px-3 ${op.kind === "add" ? "bg-success-soft text-success" : op.kind === "del" ? "bg-danger-soft text-danger" : "text-fg-muted"}`}>
                                      <span className="mr-2 inline-block w-3 select-none text-fg-subtle">{op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}</span>
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
    </div>
  );
}
