"use client";

// Getting started, on the account home: progress, the next step first, the
// rest a click away. Hidden per person (PATCH /api/me/onboarding); gone by
// itself once every step is done. The steps come from the server, derived
// from the account's real state — this only draws them.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Onboarding } from "./onboarding-model";
import { ArrowRight, ChevronDown, Circle, CircleCheck, X } from "lucide-react";
import { Button, buttonVariants } from "./kit/button";
import { cn } from "./kit/cn";
import { IconBox } from "@/components/kit/page";
import { Tooltip } from "@/components/kit/tooltip";

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
    <section className="mb-8 min-w-0 overflow-hidden rounded-lg border border-line bg-surface" aria-label="Getting started">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4">
        <h2 className="text-base font-medium text-fg">Getting started</h2>
        <span className="text-sm tabular-nums text-fg-muted">
          {data.done} of {data.total}
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={data.done} aria-valuemin={0} aria-valuemax={data.total}>
          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide steps" : "All steps"}
            <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          {canDismiss && (
            <Tooltip label="Hide this card — bring it back from the bottom of this page or with `foldrun onboarding --show`">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="Dismiss"
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
            >
              <X aria-hidden />
            </Button>
            </Tooltip>
          )}
        </div>
        {error && (
          <span role="alert" className="w-full text-xs text-danger">
            {error}
          </span>
        )}
      </header>
      <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-3">
        <IconBox round className="bg-sunken text-fg-muted">
          <ArrowRight aria-hidden />
        </IconBox>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{next.title}</p>
          <p className="text-sm text-fg-muted">{next.why}</p>
        </div>
        {next.cli && <code className="hidden rounded-md border border-line bg-sunken px-2 py-0.5 font-mono text-xs text-fg-secondary lg:inline">{next.cli}</code>}
        <Link href={withQs(next.href, qs)} className={buttonVariants({ variant: "primary", className: "max-sm:w-full" })}>
          Do it
        </Link>
      </div>
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {rest.map((s) => (
            <li key={s.id} className="flex min-w-0 items-center gap-3 px-5 py-2.5 text-sm">
              {s.done ? <CircleCheck aria-label="done" className="size-4 shrink-0 text-success" /> : <Circle aria-label="not done" className="size-4 shrink-0 text-fg-subtle" />}
              <Link href={withQs(s.href, qs)} className={cn("shrink-0 truncate hover:underline", s.done ? "text-fg-muted line-through" : "text-fg")}>
                {s.title}
              </Link>
              <span className="hidden min-w-0 truncate text-fg-muted sm:inline">{s.why}</span>
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
      className="mt-6 text-sm text-fg-muted hover:text-fg"
    >
      Show getting started ({done} of {total})
    </button>
  );
}
