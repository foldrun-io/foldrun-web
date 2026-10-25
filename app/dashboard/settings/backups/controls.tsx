"use client";

// The two ways back, as forms. Restore: a dry run first (what would change,
// file by file, with the diff), then the workspace's name typed back to do
// it. Request: what, where, when — recorded and mailed to the operator.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, selectClass, Card, FIELD_LABEL_CLASS, Badge } from "@/components/ui";
import { Banner } from "@/components/banner";
import { LocalTime } from "@/components/local-time";
import { useViewerTime } from "@/components/viewer-time";

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
      out.push(<div key={`f${i}`} className="text-fg-subtle">⋯ {folded} unchanged</div>);
      folded = 0;
    }
    out.push(
      <div key={i} className={o.kind === "add" ? "bg-emerald-50 text-emerald-800" : o.kind === "del" ? "bg-red-50 text-red-800" : "text-fg-muted"}>
        {o.kind === "add" ? "+ " : o.kind === "del" ? "- " : "  "}
        {o.text}
      </div>,
    );
  });
  if (folded) out.push(<div key="tail" className="text-fg-subtle">⋯ {folded} unchanged</div>);
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line-faint p-2 font-mono text-[11px] leading-4">{out}</pre>;
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

  if (!canWrite) return <Card className="p-4 text-sm text-fg-tertiary">Restoring a workspace needs the editor role or above.</Card>;
  if (!workspaces.some((w) => w.history)) return <Card className="p-4 text-sm text-fg-tertiary">No workspace has any history to restore from yet.</Card>;

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
      setDone(`Restored ${ws} to ${plan.to.sha.slice(0, 7)}. To undo it, restore to ${plan.from?.slice(0, 7) ?? "the previous commit"}.`);
      setPlan(null);
      setTyped("");
      router.refresh();
    }
    setBusy(false);
  };

  const current = workspaces.find((w) => w.name === ws);
  return (
    <Card className="space-y-3 p-4">
      {done && <Banner tone="ok">{done}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={preview} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Workspace</span>
          <select className={selectClass("mt-1 w-full")} value={ws} onChange={(e) => { setWs(e.target.value); setPlan(null); }}>
            {workspaces.map((w) => (
              <option key={w.name} value={w.name} disabled={!w.history}>
                {w.name}{w.history ? "" : " (no history)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>Back to</span>
          <input className={inputClass("mt-1 w-full")} value={to} onChange={(e) => { setTo(e.target.value); setPlan(null); }} placeholder="2026-09-28 14:00 · 3d · a commit" required />
        </label>
        <button type="submit" disabled={busy || !ws || !to.trim()} className={buttonClass("secondary")}>
          Preview
        </button>
      </form>
      {current?.lastChange && (
        <p className="text-xs text-fg-muted">
          Last change to {ws}: <LocalTime iso={current.lastChange.at} /> — {current.lastChange.message}. A date means the last commit at or before it; see every commit on the workspace&apos;s History page.
        </p>
      )}
      {plan && (
        <div className="space-y-3 border-t border-line-faint pt-3">
          <p className="text-sm text-fg-secondary">
            Restoring to <code className="font-mono text-xs">{plan.to.sha.slice(0, 7)}</code> — <LocalTime iso={plan.to.at} />, “{plan.to.message}” by {plan.to.by}.
          </p>
          {plan.noop ? (
            <Banner tone="info">{ws} already matches that point. Nothing would change.</Banner>
          ) : (
            <>
              <p className="text-sm text-fg-secondary">
                {plan.updated.length} changed, {plan.added.length} brought back, {plan.removed.length} removed.
                {plan.blockedBy.length > 0 && <span className="text-amber-700"> Runs in flight ({plan.blockedBy.length}) — it will be refused until they finish.</span>}
              </p>
              <ul className="space-y-1.5">
                {plan.files.map((f) => (
                  <li key={f.path} className="rounded border border-line">
                    <details>
                      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs">
                        <Badge variant={f.change === "removed" ? "error" : f.change === "added" ? "success" : "info"}>{f.change}</Badge>
                        <span className="truncate font-mono">{f.path}</span>
                      </summary>
                      <Diff ops={f.diff} />
                    </details>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className={FIELD_LABEL_CLASS}>Type {ws} to confirm</span>
                  <input className={inputClass("mt-1 w-56")} value={typed} onChange={(e) => setTyped(e.target.value)} />
                </label>
                <button type="button" onClick={restore} disabled={busy || typed !== ws} className={buttonClass("primary")}>
                  Restore {ws}
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
function SnapshotOption({ id, at }: { id: string; at: string }) {
  const text = useViewerTime(at, { dateStyle: "medium", timeStyle: "short" });
  return <option value={id}>{text || at.slice(0, 16).replace("T", " ")}</option>;
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
      setDone(req.notified ? "Asked. The platform team has been emailed and will reply." : "Asked and recorded — but the email to the platform team did not send. Please also contact them.");
      setTarget("");
      setNote("");
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <Card className="space-y-3 p-4">
      {done && <Banner tone="ok">{done}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {canAsk ? (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>What</span>
            <select className={selectClass("mt-1 w-full")} value={what} onChange={(e) => setWhat(e.target.value)}>
              <option value="runs">Run records</option>
              <option value="state">state/ files</option>
              <option value="storage">Storage files</option>
              <option value="everything">Everything</option>
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Workspace</span>
            <select className={selectClass("mt-1 w-full")} value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">All of them</option>
              {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>As it was at</span>
            <input className={inputClass("mt-1 w-full")} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="2026-09-28 14:00 Sydney" required />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Snapshot (optional)</span>
            <select className={selectClass("mt-1 w-full")} value={backupId} onChange={(e) => setBackupId(e.target.value)}>
              <option value="">The nearest before that time</option>
              {backups.map((b) => <SnapshotOption key={b.id} id={b.id} at={b.at} />)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={FIELD_LABEL_CLASS}>Note</span>
            <textarea className={inputClass("mt-1 w-full")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went wrong, and what you need back" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !target.trim()} className={buttonClass("primary")}>Send request</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-fg-tertiary">Asking for a restore needs the admin role and access to every workspace.</p>
      )}
      {requests.length > 0 && (
        <div className="border-t border-line-faint pt-3">
          <p className="mb-1.5 text-xs font-medium text-fg-muted">Earlier requests</p>
          <ul className="space-y-1 text-xs text-fg-tertiary">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2">
                <LocalTime iso={r.at} />
                <span>{r.what}</span>
                <span>{r.workspace ?? "all workspaces"}</span>
                <span>to {r.target}</span>
                <span className="text-fg-subtle">by {r.by}</span>
                <Badge>{r.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
