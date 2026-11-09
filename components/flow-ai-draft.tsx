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
import { Textarea } from "@foldrun/ui/react/input";
import { Chip } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { useCan, needs } from "@/components/role";
import { foldDiff, lineDiff } from "@/components/flow-history-model";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Sparkles } from "lucide-react";
import { DiffView } from "@/components/flow-history";
import { Dialog, DialogContent, DialogTitle } from "@foldrun/ui/react/dialog";

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
      <Tooltip label={mayWrite ? (flow ? `Describe a change and get a redrafted ${flow}` : "Describe a flow and get its markdown") : needs("workspace:write")}>
        <span className="inline-flex">
          <button
            type="button"
            disabled={!mayWrite}
            onClick={() => setOpen(true)}
            className={variant === "minimal" ? buttonVariants({ variant: "ghost", size: "sm" }) : buttonVariants({ variant: "secondary" })}
          >
            {variant === "minimal" && <Sparkles aria-hidden />}
            {label ?? (flow ? "Redraft with AI" : "Draft with AI")}
          </button>
        </span>
      </Tooltip>
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
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent hideClose aria-describedby={undefined} size="xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()} className="top-[5vh] max-h-[90dvh] max-w-3xl translate-y-0 overflow-y-auto rounded-lg text-left">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div>
              <DialogTitle className="text-sm font-semibold text-fg">{flow ? `Redraft ${flow} with AI` : "Draft a flow with AI"}</DialogTitle>
              <p className="text-[11px] text-fg-muted">A proposal only — nothing is written until you save it.</p>
            </div>
            <button type="button" onClick={onClose} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
              Close
            </button>
          </header>

          <div className="space-y-3 px-4 py-3">
            <div>
              <label htmlFor="draft-description" className="block text-xs font-medium text-fg-muted">
                {flow ? "What should change" : "What should the flow do"}
              </label>
              <Textarea
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
                className="mt-1 w-full text-sm"
              />
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-fg-subtle">
                  {description.length}/{MAX}
                </span>
                <button
                  type="button"
                  disabled={busy !== null || !description.trim()}
                  onClick={() => void request()}
                  className={cn(buttonVariants({ variant: "primary", size: "xs" }), "ml-auto")}
                >
                  {busy === "draft" ? "Drafting…" : draft ? "Draft again" : "Draft"}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            {draft && (
              <>
                {draft.notes && <p className="rounded-md bg-sunken px-3 py-2 text-xs text-fg-secondary">{draft.notes}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {errors.length === 0 ? (
                    <Chip tone="good">passes the deploy check</Chip>
                  ) : (
                    <Chip tone="bad">
                      {errors.length} error{errors.length === 1 ? "" : "s"}
                    </Chip>
                  )}
                  {draft.issues.length - errors.length > 0 && (
                    <Chip tone="warn">
                      {draft.issues.length - errors.length} warning{draft.issues.length - errors.length === 1 ? "" : "s"}
                    </Chip>
                  )}
                  {draft.repaired && <Chip tone="info">repaired once after the check</Chip>}
                </div>
                {draft.issues.length > 0 && (
                  <ul className="space-y-1">
                    {draft.issues.map((i, k) => (
                      <li
                        key={k}
                        className={`rounded-md border px-2 py-1 text-xs ${i.level === "error" ? "border-danger-line bg-danger-soft text-danger" : "border-warning-line bg-warning-soft text-warning"}`}
                      >
                        <span className="font-mono">{i.where}</span> — {i.message}
                      </li>
                    ))}
                  </ul>
                )}
                {draft.files.map((f) => (
                  <section key={f.path} className="overflow-hidden rounded-lg border border-line">
                    <header className="flex items-center gap-2 border-b border-line-faint bg-sunken px-3 py-1.5">
                      <span className="font-mono text-xs text-fg-secondary">{f.path}</span>
                      <Chip tone={f.before === null ? "good" : "warn"}>{f.before === null ? "new" : "changed"}</Chip>
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
              <button type="button" onClick={() => setDraft(null)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
                Discard
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void save()} className={buttonVariants({ variant: "primary", size: "xs" })}>
                {busy === "save" ? "Saving…" : `Save ${draft.files.length} file${draft.files.length === 1 ? "" : "s"}…`}
              </button>
            </footer>
          )}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
