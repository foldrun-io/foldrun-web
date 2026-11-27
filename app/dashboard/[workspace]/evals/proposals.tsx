"use client";

// Proposed fixes for one eval (platform improve.ts): what failed, what the
// assistant made of it, and the change it proposes as a diff per file —
// Apply writes those files (each a revision by you), Dismiss sets it aside.
// Nothing is written before Apply. "Propose a fix" asks for one now.

import { $el, $rich, $t, localized } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@foldrun/ui/react/link";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Chip, type Tone } from "@foldrun/ui/react/page";
import { DiffView } from "@/components/flow-history";
import { foldDiff, lineDiff } from "@/components/flow-history-model";
import { Markdown } from "@/components/markdown";
import { runHref } from "@/components/run-href";
import { useCan } from "@/components/role";
import { WithEmails } from "@/components/email";
import type { Proposal } from "@/platform/improve";
import { Disclosure } from "@foldrun/ui/react/disclosure";
import { Tooltip } from "@foldrun/ui/react/tooltip";

const TONE: Record<Proposal["status"], Tone> = {
  drafting: "info",
  ready: "warn",
  applying: "info",
  applied: "good",
  partial: "bad",
  failed: "bad",
  dismissed: "default",
};

const LABEL: Record<Proposal["status"], string> = localized(() => ({
  drafting: $t("workspace.evals-proposals.beingDrafted"),
  ready: $t("workspace.evals-proposals.readyToReview"),
  applying: "applying",
  applied: "applied",
  partial: $t("workspace.evals-proposals.partlyApplied"),
  failed: $t("workspace.evals-proposals.draftFailed"),
  dismissed: "dismissed",
}));

export function Proposals({
  workspace,
  tenant,
  evalName,
  proposals,
  canPropose,
}: {
  workspace: string;
  tenant: string;
  evalName: string;
  proposals: Proposal[];
  /** Whether there is anything to propose a fix for now. */
  canPropose: boolean;
}) {
  const router = useRouter();
  const write = useCan("workspace:write");
  const run = useCan("run:start");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = proposals.some((p) => p.status === "drafting" || p.status === "ready" || p.status === "applying");

  /** Run one request and refresh: the URL is written at each call below. */
  const settle = async (key: string, request: () => Promise<Response>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await request();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };
  const propose = () =>
    settle("propose", () => fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/evals/${encodeURIComponent(evalName)}/improve`, { method: "POST", headers, body: "{}" }));
  const decide = (id: string, action: "apply" | "dismiss") =>
    settle(action === "apply" ? id : `${id}-x`, () =>
      fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/proposals/${encodeURIComponent(id)}`, { method: "POST", headers, body: JSON.stringify({ action }) }),
    );

  const shown = proposals.filter((p) => p.status !== "dismissed").slice(0, 5);

  return (
    <div className="space-y-3">
      {run && canPropose && !open && (
      <div className="flex flex-wrap items-center gap-2">
        {shown.length === 0 && <span className="text-sm text-fg-muted">{$t("workspace.evals-proposals.noFixProposedYet")}</span>}
        {(
          <Tooltip label={$t("workspace.evals-proposals.theAssistantReadsTheFailuresAnd")}>
            <button
              onClick={propose}
              disabled={busy === "propose"}
              className={buttonVariants({ variant: "secondary" })}
            >
              {busy === "propose" ? $t("workspace.evals-proposals.asking") : $t("workspace.evals-proposals.proposeAFix")}
            </button>
          </Tooltip>
        )}
      </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {shown.length === 0 && !(run && canPropose && !open) && <p className="text-sm text-fg-muted">{$t("workspace.evals-proposals.noneYet")}</p>}
      {shown.length > 0 && <ul className="space-y-2">
        {shown.map((p) => (
          <li key={p.id} id={p.id} className="scroll-mt-24 rounded-lg border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Chip tone={TONE[p.status]}>{LABEL[p.status]}</Chip>
              <span className="text-fg-muted">
                {$t("workspace.evals-proposals.utc", { replace: p.createdAt.slice(0, 16).replace("T", " ") })}{" "}{p.by === "auto" ? $t("workspace.evals-proposals.openedAfterRepeatedFailures") : <>{$rich("workspace.evals-proposals.askedBy", { withEmails: $el(<WithEmails text={p.by} />) })}</>}{" "}{$t("workspace.evals-proposals.coversFailure", { length: p.failures.length })}
              </span>
              {p.decidedBy && (
                <span className="text-fg-subtle">
                  {$rich("workspace.evals-proposals.by", { status: p.status, withEmails: $el(<WithEmails text={p.decidedBy} />) })}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                {write && p.status === "ready" && (
                  <button onClick={() => decide(p.id, "apply")} disabled={!!busy} className={buttonVariants({ variant: "primary" })}>
                    {busy === p.id ? $t("workspace.evals-proposals.applying") : $t("workspace.evals-proposals.apply")}
                  </button>
                )}
                {write && (p.status === "ready" || p.status === "failed" || p.status === "drafting") && (
                  <button onClick={() => decide(p.id, "dismiss")} disabled={!!busy} className={buttonVariants({ variant: "ghost" })}>
                    {$t("workspace.evals-proposals.dismiss")}
                  </button>
                )}
              </span>
            </div>
            {p.status === "drafting" && <p className="mt-1 text-xs text-fg-muted">{$t("workspace.evals-proposals.theAssistantIsReadingTheFailures")}</p>}
            {p.error && <p className="mt-1 text-xs text-danger">{p.error}</p>}
            {(p.notes ?? []).map((n) => (
              <p key={n} className="mt-1 text-xs text-warning">
                <WithEmails text={n} />
              </p>
            ))}
            <Disclosure className="mt-1" summaryClassName="text-xs text-fg-tertiary" summary={$t("workspace.evals-proposals.theFailuresItCovers")}>
              <ul className="mt-1 space-y-0.5">
                {p.failures.map((f, i) => (
                  <li key={i} className="text-xs text-fg-secondary">
                    {f.runId ? <Link href={runHref(workspace, f.runId, tenant)} className="font-mono text-link hover:underline">{f.runId}</Link> : <span className="font-medium">{f.case}</span>} — <WithEmails text={`${f.check}: ${f.detail}`} />
                  </li>
                ))}
              </ul>
            </Disclosure>
            {p.reply && (
              <div className="mt-2 text-sm text-fg-secondary">
                <Markdown text={p.reply} />
              </div>
            )}
            {p.files.map((f) => (
              <div key={f.path} className="mt-2">
                <p className="mb-1 font-mono text-xs text-fg">{f.path}{f.before === null ? $t("workspace.evals-proposals.newFileMark") : ""}</p>
                <DiffView rows={foldDiff(lineDiff(f.before ?? "", f.content), 4)} empty={$t("workspace.evals-proposals.sameAsTheFileInThe")} />
              </div>
            ))}
            {p.issues.length > 0 && (
              <ul className="mt-1">
                {p.issues.map((i, n) => (
                  <li key={n} className={`text-xs ${i.level === "error" ? "text-danger" : "text-warning"}`}>
                    <WithEmails text={`${i.where}: ${i.message}`} />
                  </li>
                ))}
              </ul>
            )}
            {p.applied && p.status !== "applied" && <p className="mt-1 text-xs text-fg-muted">{$t("workspace.evals-proposals.writtenFiles", { files: p.applied.join(", ") || $t("workspace.evals-proposals.nothing") })}</p>}
          </li>
        ))}
      </ul>}
    </div>
  );
}
