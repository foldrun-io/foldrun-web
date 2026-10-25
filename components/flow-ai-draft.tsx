"use client";

// "Draft with AI" — describe a flow in words, get its markdown back.
//
// The server (POST …/flows/draft) asks a model for the flow file and any
// agent files it needs, checks them with the deploy's own checks, and lets
// the model repair once. Nothing is written by that call. This dialog shows
// each proposed file as a diff against what the workspace has, lists what
// the check still finds, and writes the files through the ordinary source
// PUT only when the person presses Save and confirms — so a draft is a
// revision like any edit, attributed and restorable from History.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, Badge } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useCan, needs } from "@/components/role";
import { foldDiff, lineDiff } from "@/components/flow-history-model";
import { DiffView } from "@/components/flow-history";

interface DraftFile {
  path: string;
  content: string;
  before: string | null;
  sha256: string | null;
}
interface DraftIssue {
  where: string;
  message: string;
  level: "error" | "warn";
}
interface Draft {
  files: DraftFile[];
  issues: DraftIssue[];
  repaired: boolean;
  notes: string;
}

const MAX = 4000;

export function FlowAiDraft({
  workspace,
  tenant,
  flow,
  label,
  variant = "minimal",
}: {
  workspace: string;
  tenant: string;
  /** Redraft this flow; omitted, the draft is a new flow. */
  flow?: string;
  label?: string;
  variant?: "minimal" | "secondary";
}) {
  const mayWrite = useCan("workspace:write");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={!mayWrite}
        title={mayWrite ? (flow ? `Describe a change and get a redrafted ${flow}` : "Describe a flow and get its markdown") : needs("workspace:write")}
        onClick={() => setOpen(true)}
        className={buttonClass(variant, variant === "minimal" ? "px-2 py-1 text-xs" : "")}
      >
        {label ?? (flow ? "Redraft with AI" : "Draft with AI")}
      </button>
      {open && <DraftDialog workspace={workspace} tenant={tenant} flow={flow} onClose={() => setOpen(false)} />}
    </>
  );
}

function DraftDialog({ workspace, tenant, flow, onClose }: { workspace: string; tenant: string; flow?: string; onClose: () => void }) {
  const router = useRouter();
  const [ask, dialog] = useConfirm();
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant, "content-type": "application/json" }), [tenant]);

  const errors = draft?.issues.filter((i) => i.level === "error") ?? [];

  const request = async () => {
    setBusy("draft");
    setError(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/flows/draft`, {
        method: "POST",
        headers,
        body: JSON.stringify({ description, ...(flow ? { flow } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as Draft & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `the draft was refused (${res.status})`);
        return;
      }
      setDraft(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not draft");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    const ok = await ask({
      title: `Save ${draft.files.length} file${draft.files.length === 1 ? "" : "s"} to ${workspace}?`,
      body: (
        <>
          <ul className="mb-2 list-disc pl-5 font-mono text-xs">
            {draft.files.map((f) => (
              <li key={f.path}>
                {f.path} {f.before === null ? "(new)" : "(replaces what is there)"}
              </li>
            ))}
          </ul>
          {errors.length > 0
            ? `The check still finds ${errors.length} error${errors.length === 1 ? "" : "s"}; the files are saved as they are and the flow card will show them.`
            : "Each file is saved as a revision you can restore from History."}
        </>
      ),
      confirmLabel: "Save files",
      destructive: draft.files.some((f) => f.before !== null),
    });
    if (!ok) return;
    setBusy("save");
    setError(null);
    const message = `drafted with AI: ${description.trim().replace(/\s+/g, " ").slice(0, 80)}`;
    const done: string[] = [];
    try {
      for (const f of draft.files) {
        const res = await fetch(`/api/workspaces/${workspace}/source`, {
          method: "PUT",
          headers,
          // A new file expects none there (ifMatch: null): one created since
          // the draft is refused, not overwritten.
          body: JSON.stringify({ path: f.path, content: f.content, message, ifMatch: f.sha256 ?? null }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `${f.path}: ${res.status === 409 ? `${f.before === null ? "created by someone else" : "changed"} since the draft was made — draft again` : (body.error ?? `refused (${res.status})`)}` +
              (done.length ? ` (already saved: ${done.join(", ")})` : ""),
          );
        }
        done.push(f.path);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8" role="presentation">
        <div role="dialog" aria-label={flow ? `Redraft ${flow} with AI` : "Draft a flow with AI"} className="w-full max-w-3xl rounded-xl border border-line bg-surface text-left shadow-xl">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{flow ? `Redraft ${flow} with AI` : "Draft a flow with AI"}</h2>
              <p className="text-[11px] text-fg-muted">A proposal only — nothing is written until you save it.</p>
            </div>
            <button type="button" onClick={onClose} className={buttonClass("minimal", "ml-auto px-2 py-1 text-xs")}>
              Close
            </button>
          </header>

          <div className="space-y-3 px-4 py-3">
            <div>
              <label htmlFor="draft-description" className="block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {flow ? "What should change" : "What should the flow do"}
              </label>
              <textarea
                id="draft-description"
                value={description}
                maxLength={MAX}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder={
                  flow
                    ? "e.g. add a fact-check step before the writer, and ask me before anything is sent"
                    : "e.g. every Monday at 8, gather the week's industry news, check the facts, and email me a five-item digest after I approve it"
                }
                className={inputClass("mt-1 w-full text-sm")}
              />
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-fg-subtle">
                  {description.length}/{MAX}
                </span>
                <button
                  type="button"
                  disabled={busy !== null || !description.trim()}
                  onClick={() => void request()}
                  className={buttonClass("primary", "ml-auto px-3 py-1 text-xs")}
                >
                  {busy === "draft" ? "Drafting…" : draft ? "Draft again" : "Draft"}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            {draft && (
              <>
                {draft.notes && <p className="rounded-md bg-sunken px-3 py-2 text-xs text-fg-secondary">{draft.notes}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {errors.length === 0 ? (
                    <Badge variant="success">passes the deploy check</Badge>
                  ) : (
                    <Badge variant="error">
                      {errors.length} error{errors.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {draft.issues.length - errors.length > 0 && (
                    <Badge variant="warning">
                      {draft.issues.length - errors.length} warning{draft.issues.length - errors.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {draft.repaired && <Badge variant="info">repaired once after the check</Badge>}
                </div>
                {draft.issues.length > 0 && (
                  <ul className="space-y-1">
                    {draft.issues.map((i, k) => (
                      <li
                        key={k}
                        className={`rounded-md border px-2 py-1 text-xs ${i.level === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                      >
                        <span className="font-mono">{i.where}</span> — {i.message}
                      </li>
                    ))}
                  </ul>
                )}
                {draft.files.map((f) => (
                  <section key={f.path} className="overflow-hidden rounded-lg border border-line">
                    <header className="flex items-center gap-2 border-b border-line-faint bg-sunken px-3 py-1.5">
                      <span className="font-mono text-xs text-gray-800">{f.path}</span>
                      <Badge variant={f.before === null ? "success" : "warning"}>{f.before === null ? "new" : "changed"}</Badge>
                    </header>
                    <div className="max-h-80 overflow-auto">
                      <DiffView rows={foldDiff(lineDiff(f.before ?? "", f.content), 4)} empty="Same as the file in the workspace." />
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>

          {draft && draft.files.length > 0 && (
            <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
              <span className="text-[11px] text-fg-muted">Saving writes these files as one edit each, through the same save as the editor.</span>
              <button type="button" onClick={() => setDraft(null)} className={buttonClass("minimal", "ml-auto px-2 py-1 text-xs")}>
                Discard
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void save()} className={buttonClass("primary", "px-3 py-1 text-xs")}>
                {busy === "save" ? "Saving…" : `Save ${draft.files.length} file${draft.files.length === 1 ? "" : "s"}…`}
              </button>
            </footer>
          )}
        </div>
      </div>
      {dialog}
    </>
  );
}
