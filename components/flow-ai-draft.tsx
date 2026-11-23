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

import { $t } from "@/i18n";
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
      <Tooltip label={mayWrite ? (flow ? $t("components.flow-ai-draft.describeAChangeAndGetA", { flow: String(flow) }) : $t("components.flow-ai-draft.describeAFlowAndGetIts")) : needs("workspace:write")}>
        <span className="inline-flex">
          <button
            type="button"
            disabled={!mayWrite}
            onClick={() => setOpen(true)}
            className={variant === "minimal" ? buttonVariants({ variant: "ghost", size: "sm" }) : buttonVariants({ variant: "secondary" })}
          >
            {variant === "minimal" && <Sparkles aria-hidden />}
            {label ?? (flow ? $t("components.flow-ai-draft.redraftWithAi") : $t("components.flow-ai-draft.draftWithAi"))}
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
      const res = await fetch(`/v1/workspaces/${workspace}/flows/draft`, {
        method: "POST",
        headers,
        body: JSON.stringify({ description, ...(flow ? { flow } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as Draft & { error?: string };
      if (!res.ok) {
        setError(body.error ?? $t("components.flow-ai-draft.theDraftWasRefused", { status: String(res.status) }));
        return;
      }
      setDraft(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : $t("components.flow-ai-draft.couldNotDraft"));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    const ok = await ask({
      title: $t("components.flow-ai-draft.saveFileTo", { length: String(draft.files.length), v1: draft.files.length, workspace: String(workspace) }),
      body: (
        <>
          <ul className="mb-2 list-disc pl-5 font-mono text-xs">
            {draft.files.map((f) => (
              <li key={f.path}>
                {f.path} {f.before === null ? $t("components.flow-ai-draft.new") : $t("components.flow-ai-draft.replacesWhatIsThere")}
              </li>
            ))}
          </ul>
          {errors.length > 0
            ? $t("components.flow-ai-draft.theCheckStillFindsErrorThe", { length: String(errors.length), v1: errors.length })
            : $t("components.flow-ai-draft.eachFileIsSavedAsA")}
        </>
      ),
      confirmLabel: $t("components.flow-ai-draft.saveFiles"),
      destructive: draft.files.some((f) => f.before !== null),
    });
    if (!ok) return;
    setBusy("save");
    setError(null);
    const message = $t("components.flow-ai-draft.draftedWithAi", { v0: String(description.trim().replace(/\s+/g, " ").slice(0, 80)) });
    const done: string[] = [];
    try {
      for (const f of draft.files) {
        const res = await fetch(`/v1/workspaces/${workspace}/source`, {
          method: "PUT",
          headers,
          // A new file expects none there (ifMatch: null): one created since
          // the draft is refused, not overwritten.
          body: JSON.stringify({ path: f.path, content: f.content, message, ifMatch: f.sha256 ?? null }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `${f.path}: ${res.status === 409 ? $t("components.flow-ai-draft.sinceTheDraftWasMadeDraft", { v0: String(f.before === null ? $t("components.flow-ai-draft.createdBySomeoneElse") : $t("components.flow-ai-draft.changed")) }) : (body.error ?? $t("components.flow-ai-draft.refused", { status: String(res.status) }))}` +
              (done.length ? $t("components.flow-ai-draft.alreadySaved", { v0: String(done.join(", ")) }) : ""),
          );
        }
        done.push(f.path);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : $t("components.flow-ai-draft.saveFailed"));
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
              <DialogTitle className="text-sm font-semibold text-fg">{flow ? $t("components.flow-ai-draft.redraftWithAi2", { flow: String(flow) }) : $t("components.flow-ai-draft.draftAFlowWithAi")}</DialogTitle>
              <p className="text-[11px] text-fg-muted">{$t("components.flow-ai-draft.aProposalOnlyNothingIsWritten")}</p>
            </div>
            <button type="button" onClick={onClose} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
              {$t("components.flow-ai-draft.close")}
            </button>
          </header>

          <div className="space-y-3 px-4 py-3">
            <div>
              <label htmlFor="draft-description" className="block text-xs font-medium text-fg-muted">
                {flow ? $t("components.flow-ai-draft.whatShouldChange") : $t("components.flow-ai-draft.whatShouldTheFlowDo")}
              </label>
              <Textarea
                id="draft-description"
                value={description}
                maxLength={MAX}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder={
                  flow
                    ? $t("components.flow-ai-draft.eGAddAFactCheck")
                    : $t("components.flow-ai-draft.eGEveryMondayAt8")
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
                  {busy === "draft" ? $t("components.flow-ai-draft.drafting") : draft ? $t("components.flow-ai-draft.draftAgain") : $t("components.flow-ai-draft.draft")}
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
                    <Chip tone="good">{$t("components.flow-ai-draft.passesTheDeployCheck")}</Chip>
                  ) : (
                    <Chip tone="bad">
                      {$t("components.flow-ai-draft.error", { length: errors.length })}
                    </Chip>
                  )}
                  {draft.issues.length - errors.length > 0 && (
                    <Chip tone="warn">
                      {$t("components.flow-ai-draft.warning", { length: draft.issues.length - errors.length })}
                    </Chip>
                  )}
                  {draft.repaired && <Chip tone="info">{$t("components.flow-ai-draft.repairedOnceAfterTheCheck")}</Chip>}
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
                      <Chip tone={f.before === null ? "good" : "warn"}>{f.before === null ? $t("values.fileChange.new") : $t("values.fileChange.changed")}</Chip>
                    </header>
                    <div className="max-h-80 overflow-auto">
                      <DiffView rows={foldDiff(lineDiff(f.before ?? "", f.content), 4)} empty={$t("components.flow-ai-draft.sameAsTheFileInThe")} />
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>

          {draft && draft.files.length > 0 && (
            <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
              <span className="text-[11px] text-fg-muted">{$t("components.flow-ai-draft.savingWritesTheseFilesAsOne")}</span>
              <button type="button" onClick={() => setDraft(null)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
                {$t("components.flow-ai-draft.discard")}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void save()} className={buttonVariants({ variant: "primary", size: "xs" })}>
                {busy === "save" ? $t("components.flow-ai-draft.saving") : $t("components.flow-ai-draft.saveFile", { length: String(draft.files.length), v1: draft.files.length })}
              </button>
            </footer>
          )}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
