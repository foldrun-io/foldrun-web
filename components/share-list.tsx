"use client";

// Active public links for one desk: what is shared, who shared it, when, and
// until when — with a Revoke that asks first and then kills the link. The
// dashboard counterpart of `foldrun storage shares` / `storage unshare`; the
// file browser already shares and un-shares a file on its own row, this is the
// one place that lists every live link together, including who minted it.
//
// The rows are read on the server (the Storage page passes them in); only the
// revoke happens here, through the same DELETE the CLI calls, so the server
// still decides who may take a link down. After any change the page is read
// again (router.refresh), and a new server list replaces the local one — the
// file browser above does the same, so the two never contradict each other.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WithEmails } from "@/components/email";
import { useConfirm } from "@/components/confirm";
import { buttonClass, Card } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import {
  isLiveShare,
  shareStatus,
  shareWho,
  visibleShares,
  type ShareRow,
} from "@/components/share-list-model";

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 2600);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink/95 px-4 py-2 text-sm text-on-ink shadow-lg">{text}</div>
  );
}

export function ShareList({
  rows: initial,
  workspace,
  tenant,
  now,
  canRevoke,
}: {
  rows: ShareRow[];
  workspace: string;
  tenant: string;
  now: number;
  canRevoke: boolean;
}) {
  const router = useRouter();
  // Local edits (a revoke) sit on the server's list until the server sends a
  // new one — FileBrowser's pattern.
  const [rows, setRows] = useState(initial);
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setRows(initial);
  }
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const shown = useMemo(() => visibleShares(rows, now, all), [rows, now, all]);
  const liveCount = useMemo(() => rows.filter((r) => isLiveShare(r, now)).length, [rows, now]);
  const hidden = rows.length - liveCount;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied");
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const revoke = async (s: ShareRow) => {
    if (!(await confirm({
      title: "Revoke this link?",
      body: `${s.path} — anyone holding the link gets 404 from now on, and the token is never reused.`,
      confirmLabel: "Revoke link",
      destructive: true,
    }))) return;
    setBusy(s.id);
    try {
      const r = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/shares?id=${encodeURIComponent(s.id)}`, {
        method: "DELETE",
        headers: { "x-foldrun-tenant": tenant },
      });
      const j = (await r.json().catch(() => ({}))) as { revoked?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error ?? `could not revoke (${r.status})`);
      if (!j.revoked) {
        setToast(`nothing revoked — that is not a live link`);
      } else {
        setRows((rs) => rs.map((x) => (x.id === s.id ? { ...x, revokedAt: new Date().toISOString() } : x)));
        setToast(`Revoked — the link answers 404 from now on`);
      }
      // Either way the server knows better than this list, and the file
      // browser's "Copy link" must stop offering a revoked token.
      router.refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Active links</h2>
        {hidden > 0 && (
          <button type="button" className="text-xs font-medium text-fg-muted hover:text-fg" onClick={() => setAll((v) => !v)}>
            {all ? "Hide expired and revoked" : `Show expired and revoked (${hidden})`}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-fg-muted">
          No live links in {workspace}. Share a file above to mint one; it is a link anyone can fetch until it expires or you revoke it.
        </p>
      ) : (
        <Card className="divide-y divide-line-faint">
          {shown.map((s) => {
            const status = shareStatus(s, now);
            return (
              <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{s.path}</div>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    <span className={status.live ? "text-fg-secondary" : "text-red-700"}>{status.label}</span>
                    {" · by "}<WithEmails text={shareWho(s.createdBy)} />
                    {" · shared "}<LocalTime iso={s.createdAt} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {status.live && s.url && (
                    <button type="button" className={buttonClass("secondary", "text-xs")} onClick={() => copy(s.url!)}>
                      Copy link
                    </button>
                  )}
                  {status.live && canRevoke && (
                    <button type="button" className={buttonClass("destructive", "text-xs")} disabled={busy === s.id} onClick={() => revoke(s)}>
                      {busy === s.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
      {confirmDialog}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
