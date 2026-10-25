"use client";

// Getting started, on the account home: progress, the next step first, the
// rest a click away. Hidden per person (PATCH /api/me/onboarding); gone by
// itself once every step is done. The steps come from the server, derived
// from the account's real state — this only draws them.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Onboarding } from "./onboarding-model";
import { buttonClass } from "./ui";

function withQs(href: string, qs: string): string {
  if (!qs) return href;
  const [p, hash] = href.split("#");
  const joined = p.includes("?") ? `${p}&${qs.slice(1)}` : `${p}${qs}`;
  return hash ? `${joined}#${hash}` : joined;
}

/** Null when saved, else what went wrong — a 401/403 is said, not swallowed. */
async function setDismissed(dismissed: boolean): Promise<string | null> {
  try {
    const res = await fetch("/api/me/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dismissed }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof data.error === "string" ? data.error : `${res.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function OnboardingCard({ data, qs, canDismiss }: { data: Onboarding; qs: string; canDismiss: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (data.complete || !data.next) return null;
  const pct = Math.round((data.done / data.total) * 100);
  const next = data.next;
  const rest = data.steps.filter((s) => s.id !== next.id);

  return (
    <section className="mb-4 rounded-xl border border-line bg-surface shadow-sm" aria-label="Getting started">
      <header className="flex items-center gap-3 border-b border-line-faint px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-fg">Getting started</h2>
        <span className="text-[11px] tabular-nums text-fg-muted">
          {data.done} of {data.total}
        </span>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={data.done} aria-valuemin={0} aria-valuemax={data.total}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-xs text-fg-muted hover:text-fg">
          {open ? "Hide steps" : "All steps"}
        </button>
        {canDismiss && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const failed = await setDismissed(true);
                if (failed) setError(`not dismissed — ${failed}`);
                else router.refresh();
              } finally {
                setBusy(false);
              }
            }}
            className="text-xs text-fg-subtle hover:text-fg"
            title="Hide this card — bring it back from the bottom of this page or with `foldrun onboarding --show`"
          >
            Dismiss
          </button>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        )}
      </header>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="rounded bg-muted px-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">Next</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{next.title}</p>
          <p className="text-xs text-fg-muted">{next.why}</p>
        </div>
        {next.cli && <code className="hidden rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-tertiary md:inline">{next.cli}</code>}
        <Link href={withQs(next.href, qs)} className={buttonClass("primary", "shrink-0")}>
          Do it
        </Link>
      </div>
      {open && (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {rest.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 px-4 py-2 text-sm">
              <span
                aria-label={s.done ? "done" : "not done"}
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${s.done ? "bg-emerald-500 text-white" : "border border-line-strong"}`}
              >
                {s.done ? "✓" : ""}
              </span>
              <Link href={withQs(s.href, qs)} className={`truncate hover:underline ${s.done ? "text-fg-subtle line-through" : "text-fg"}`}>
                {s.title}
              </Link>
              <span className="hidden truncate text-xs text-fg-muted sm:inline">{s.why}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The way back once hidden: one quiet line, only while steps remain. */
export function OnboardingReopen({ done, total }: { done: number; total: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await setDismissed(false);
        router.refresh();
      }}
      className="mt-6 text-xs text-fg-subtle hover:text-fg-secondary"
    >
      Show getting started ({done} of {total})
    </button>
  );
}
