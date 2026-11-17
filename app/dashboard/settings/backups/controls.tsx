"use client";

// The two ways back, as forms. Restore: a dry run first (what would change,
// file by file, with the diff), then the workspace's name typed back to do
// it. Request: what, where, when — recorded and mailed to the operator.

import { FILE_CHANGE_LABEL, labelOf } from "@/components/value-labels";
import { $el, $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, Textarea } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Chip, Card, Field, Callout } from "@foldrun/ui/react/page";
import { LocalTime } from "@/components/local-time";
import { useViewerTime } from "@/components/viewer-time";
import { Disclosure } from "@foldrun/ui/react/disclosure";

type DiffOp = { kind: "same" | "add" | "del"; text: string };
interface Plan {
  to: { sha: string; at: string; by: string; message: string };
  from: string | null;
  added: string[];
  updated: string[];
  removed: string[];
  files: { path: string; change: "added" | "updated" | "removed"; diff: DiffOp[] }[];
  blockedBy: string[];
  noop: boolean;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function Diff({ ops }: { ops: DiffOp[] }) {
  // Changed lines with two lines of context; long runs of sameness folded.
  const keep = ops.map((o, i) => o.kind !== "same" || ops.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same"));
  const out: React.ReactNode[] = [];
  let folded = 0;
  ops.forEach((o, i) => {
    if (!keep[i]) {
      folded++;
      return;
    }
    if (folded) {
      out.push(<div key={`f${i}`} className="text-fg-subtle">{$t("settings.backups-controls.unchanged", { folded: String(folded) })}</div>);
      folded = 0;
    }
    out.push(
      <div key={i} className={o.kind === "add" ? "bg-success-soft text-success" : o.kind === "del" ? "bg-danger-soft text-danger" : "text-fg-muted"}>
        {o.kind === "add" ? "+ " : o.kind === "del" ? "- " : "  "}
        {o.text}
      </div>,
    );
  });
  if (folded) out.push(<div key="tail" className="text-fg-subtle">{$t("settings.backups-controls.unchanged", { folded: String(folded) })}</div>);
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line p-2 font-mono text-xs leading-5">{out}</pre>;
}

export function RestoreWorkspace({
  workspaces,
  canWrite,
}: {
  workspaces: { name: string; history: boolean; lastChange: { at: string; message: string } | null }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [ws, setWs] = useState(workspaces.find((w) => w.history)?.name ?? "");
  const [to, setTo] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canWrite) return <Card className="p-5 text-sm text-fg-muted sm:p-6">{$t("settings.backups-controls.restoringAWorkspaceNeedsTheEditor")}</Card>;
  if (!workspaces.some((w) => w.history)) return <Card className="p-5 text-sm text-fg-muted sm:p-6">{$t("settings.backups-controls.noWorkspaceHasAnyHistoryTo")}</Card>;

  const preview = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    setPlan(null);
    const r = await post(`/api/workspaces/${encodeURIComponent(ws)}/restore`, { to, dryRun: true });
    if (!r.ok) setError(String(r.body.error ?? `HTTP ${r.status}`));
    else setPlan(r.body as unknown as Plan);
    setBusy(false);
  };

  const restore = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const r = await post(`/api/workspaces/${encodeURIComponent(ws)}/restore`, { to: plan.to.sha, confirm: typed, expectRemoved: plan.removed });
    if (!r.ok) setError(String(r.body.error ?? `HTTP ${r.status}`));
    else {
      setDone($t("settings.backups-controls.restoredToToUndoItRestore", { ws: String(ws), v1: String(plan.to.sha.slice(0, 7)), v2: String(plan.from?.slice(0, 7) ?? $t("settings.backups-controls.thePreviousCommit")) }));
      setPlan(null);
      setTyped("");
      router.refresh();
    }
    setBusy(false);
  };

  const current = workspaces.find((w) => w.name === ws);
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      {done && <Callout tone="success" role="status" className="mb-4">{done}</Callout>}
      {error && <Callout tone="danger" role="alert" className="mb-4">{error}</Callout>}
      <form onSubmit={preview} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <Field label={$t("settings.backups-controls.workspace")}>
          <Select className="w-full" value={ws} onChange={(e) => { setWs(e.target.value); setPlan(null); }}>
            {workspaces.map((w) => (
              <option key={w.name} value={w.name} disabled={!w.history}>
                {w.name}{w.history ? "" : $t("settings.backups-controls.noHistory")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={$t("settings.backups-controls.backTo")}>
          <Input className="w-full" value={to} onChange={(e) => { setTo(e.target.value); setPlan(null); }} placeholder={$t("settings.backups-controls.2026092814003d")} required />
        </Field>
        <button type="submit" disabled={busy || !ws || !to.trim()} className={buttonVariants({ variant: "secondary", size: "md" })}>
          {$t("settings.backups-controls.preview")}
        </button>
      </form>
      {current?.lastChange && (
        <p className="text-xs text-fg-muted">
          {$rich("settings.backups-controls.lastChangeToADateMeans", { ws: ws, localTime: $el(<LocalTime iso={current.lastChange.at} />), message: current.lastChange.message })}
        </p>
      )}
      {plan && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-sm text-fg-secondary">
            {$rich("settings.backups-controls.restoringToBy", { slice: plan.to.sha.slice(0, 7), code: (chunks) => <code className="font-mono text-xs">{chunks}</code>, localTime: $el(<LocalTime iso={plan.to.at} />), message: plan.to.message, by: plan.to.by })}
          </p>
          {plan.noop ? (
            <Callout tone="neutral" role="status" className="mb-4">{$t("settings.backups-controls.alreadyMatchesThatPointNothingWould", { ws: ws })}</Callout>
          ) : (
            <>
              <p className="text-sm text-fg-secondary">
                {$t("settings.backups-controls.changedBroughtBackRemoved", { length: String(plan.updated.length), length2: String(plan.added.length), length3: String(plan.removed.length) })}
                {plan.blockedBy.length > 0 && <span className="text-warning">{" "}{$t("settings.backups-controls.runsInFlightItWillBe", { length: String(plan.blockedBy.length) })}</span>}
              </p>
              <ul className="space-y-1.5">
                {plan.files.map((f) => (
                  <li key={f.path} className="rounded-md border border-line">
                    <Disclosure summaryClassName="flex items-center gap-2 px-2 py-1.5 text-xs" summary={<><Chip tone={f.change === "removed" ? "bad" : f.change === "added" ? "good" : "info"}>{labelOf(FILE_CHANGE_LABEL, f.change)}</Chip>
                        <span className="truncate font-mono">{f.path}</span></>}>
                      <Diff ops={f.diff} />
                    </Disclosure>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={<>{$t("settings.backups-controls.typeToConfirm", { ws: ws })}</>}>
                  <Input className="w-56 max-w-full" value={typed} onChange={(e) => setTyped(e.target.value)} />
                </Field>
                <button type="button" onClick={restore} disabled={busy || typed !== ws} className={buttonVariants({ variant: "primary", size: "md" })}>
                  {$t("settings.backups-controls.restore", { ws: ws })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** One snapshot, in the viewer's clock (filled after hydration). */
/** A snapshot's time, in the viewer's clock — an option's label. */
function SnapshotTime({ at }: { at: string }) {
  const text = useViewerTime(at, { dateStyle: "medium", timeStyle: "short" });
  return <>{text || at.slice(0, 16).replace("T", " ")}</>;
}

interface RequestRow {
  id: string;
  workspace: string | null;
  what: string;
  target: string;
  at: string;
  by: string;
  status: string;
  notified: boolean;
}

export function RequestRestore({
  workspaces,
  backups,
  canAsk,
  requests,
}: {
  workspaces: string[];
  backups: { id: string; at: string }[];
  canAsk: boolean;
  requests: RequestRow[];
}) {
  const router = useRouter();
  const [what, setWhat] = useState("runs");
  const [workspace, setWorkspace] = useState("");
  const [target, setTarget] = useState("");
  const [backupId, setBackupId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/account/backups/requests", { what, workspace: workspace || null, target, backupId: backupId || null, note });
    if (!r.ok) setError(String(r.body.error ?? `HTTP ${r.status}`));
    else {
      const req = r.body.request as RequestRow;
      setDone(req.notified ? $t("settings.backups-controls.askedThePlatformTeamHasBeen") : $t("settings.backups-controls.askedAndRecordedButTheEmail"));
      setTarget("");
      setNote("");
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      {done && <Callout tone="success" role="status" className="mb-4">{done}</Callout>}
      {error && <Callout tone="danger" role="alert" className="mb-4">{error}</Callout>}
      {canAsk ? (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label={$t("settings.backups-controls.what")}>
            <Select className="w-full" value={what} onChange={(e) => setWhat(e.target.value)}>
              <option value="runs">{$t("settings.backups-controls.runRecords")}</option>
              <option value="state">{$t("settings.backups-controls.stateFiles")}</option>
              <option value="storage">{$t("settings.backups-controls.storageFiles")}</option>
              <option value="everything">{$t("settings.backups-controls.everything")}</option>
            </Select>
          </Field>
          <Field label={$t("settings.backups-controls.workspace")}>
            <Select className="w-full" value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">{$t("settings.backups-controls.allOfThem")}</option>
              {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </Field>
          <Field label={$t("settings.backups-controls.asItWasAt")}>
            <Input className="w-full" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={$t("settings.backups-controls.202609281400Sydney")} required />
          </Field>
          <Field label={$t("settings.backups-controls.snapshotOptional")}>
            <Select className="w-full" value={backupId} onChange={(e) => setBackupId(e.target.value)}>
              <option value="">{$t("settings.backups-controls.theNearestBeforeThatTime")}</option>
              {backups.map((b) => <option key={b.id} value={b.id}><SnapshotTime at={b.at} /></option>)}
            </Select>
          </Field>
          <Field label={$t("settings.backups-controls.note")} className="sm:col-span-2">
            <Textarea className="w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={$t("settings.backups-controls.whatWentWrongAndWhatYou")} />
          </Field>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !target.trim()} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("settings.backups-controls.sendRequest")}</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-fg-tertiary">{$t("settings.backups-controls.askingForARestoreNeedsThe")}</p>
      )}
      {requests.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-1.5 text-sm font-medium text-fg">{$t("settings.backups-controls.earlierRequests")}</p>
          <ul className="space-y-1 text-sm text-fg-muted">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2">
                <LocalTime iso={r.at} />
                <span>{r.what}</span>
                <span>{r.workspace ?? $t("settings.backups-controls.allWorkspace")}</span>
                <span>{$t("settings.backups-controls.to", { target: r.target })}</span>
                <span className="text-fg-subtle">{$t("settings.backups-controls.by", { by: r.by })}</span>
                <Chip>{r.status}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
