"use client";

// The inbox's rows (server/inbox.ts), with your marks: opening an item marks
// it read; Set aside hides it from your view only — a gate still waits, an
// issue stays open for everyone else (POST /api/me/inbox).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { WithEmails } from "@/components/email";
import type { InboxItem } from "@/server/inbox";

const KIND: Record<InboxItem["kind"], { label: string; tone: string }> = {
  approval: { label: "approval", tone: "text-amber-800 bg-amber-50 ring-amber-200" },
  question: { label: "question", tone: "text-blue-800 bg-blue-50 ring-blue-200" },
  issue: { label: "issue", tone: "text-red-700 bg-red-50 ring-red-200" },
  proposal: { label: "proposed fix", tone: "text-violet-800 bg-violet-50 ring-violet-200" },
  run: { label: "your run", tone: "text-fg-secondary bg-muted ring-line" },
};

export function InboxList({ items, tenant, dismissedView }: { items: InboxItem[]; tenant: string; dismissedView: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mark = async (ids: string[], action: "read" | "unread" | "dismiss" | "restore", key: string) => {
    setBusy(key);
    setError(null);
    try {
      // The route takes at most 200 ids a call: Mark all read on a long tab goes in batches.
      for (let i = 0; i < ids.length; i += 200) {
        const res = await fetch("/api/me/inbox", {
          method: "POST",
          headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify({ ids: ids.slice(i, i + 200), action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const unread = items.filter((i) => !i.read).map((i) => i.id);

  return (
    <>
      {!dismissedView && unread.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button onClick={() => mark(unread, "read", "all")} disabled={busy === "all"} className={buttonClass("minimal")}>
            Mark all read
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-line-faint overflow-hidden rounded-xl border border-line bg-surface">
        {items.map((i) => (
          <li key={i.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${i.read ? "" : "bg-accent-soft/30"}`}>
            <span className={`mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${KIND[i.kind].tone}`}>{KIND[i.kind].label}</span>
            <div className="min-w-0 flex-1">
              <Link
                href={i.href}
                onClick={() => {
                  if (!i.read) void mark([i.id], "read", i.id);
                }}
                className={`block truncate text-sm hover:underline ${i.read ? "text-fg-secondary" : "font-semibold text-fg"}`}
              >
                <WithEmails text={i.title} />
              </Link>
              {/* An address in a question or a reason goes through WithEmails: a proxy may rewrite one in the HTML. */}
              {i.detail && (
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                  <WithEmails text={i.detail} />
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-fg-subtle">
                {i.workspace} · {i.why} · <LocalTime iso={i.at} />
              </p>
            </div>
            <span className="flex shrink-0 gap-1">
              {!dismissedView && (
                <button onClick={() => mark([i.id], i.read ? "unread" : "read", `${i.id}-r`)} disabled={!!busy} className={buttonClass("minimal")}>
                  {i.read ? "Mark unread" : "Mark read"}
                </button>
              )}
              <button
                onClick={() => mark([i.id], dismissedView ? "restore" : "dismiss", `${i.id}-d`)}
                disabled={!!busy}
                className={buttonClass("minimal")}
                title={dismissedView ? "Put it back in your inbox" : "Hide it from your inbox — it is still waiting for whoever decides it"}
              >
                {dismissedView ? "Put back" : "Set aside"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
