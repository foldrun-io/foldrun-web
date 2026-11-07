"use client";

// Getting started, on the account home (cloudhost's GettingStartedCard),
// drawn with the kit's ChecklistCard: a ring for how far along the account
// is, every step ticking itself from the account's real state, the next one
// opened up as the primary action, and "Resume setup" back into the welcome
// flow. A step hides from its "…" menu, the whole card from the card's
// (PATCH /api/me/onboarding) — both a person's own choice. Gone by itself
// once every step is done or hidden. The steps come from the server; this
// only draws them.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Onboarding, OnboardingStepId } from "./onboarding-model";
import { Bot, Boxes, CalendarClock, CircleCheck, Cpu, CreditCard, Eye, KeyRound, Play, Terminal, UserPlus, X } from "lucide-react";
import { buttonVariants } from "./kit/button";
import { ChecklistCard } from "./kit/checklist";
import { MenuItem } from "./kit/menu";

export function withQs(href: string, qs: string): string {
  if (!qs) return href;
  const [p, hash] = href.split("#");
  const joined = p.includes("?") ? `${p}&${qs.slice(1)}` : `${p}${qs}`;
  return hash ? `${joined}#${hash}` : joined;
}

/** Null when saved, else what went wrong — a 401/403 is said, not swallowed. */
export async function patchOnboarding(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/me/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof data.error === "string" ? data.error : `${res.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A PATCH, then the page again; what failed is said where it happened. */
export function useOnboardingPatch() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const failed = await patchOnboarding(body);
      if (failed) setError(`not saved — ${failed}`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

export const STEP_ICON: Record<OnboardingStepId, ReactNode> = {
  model: <Cpu />,
  workspace: <Boxes />,
  agent: <Bot />,
  run: <Play />,
  success: <CircleCheck />,
  secret: <KeyRound />,
  trigger: <CalendarClock />,
  teammate: <UserPlus />,
  billing: <CreditCard />,
  cli: <Terminal />,
};

/** `canDismiss`: a signed-in person, who has prefs to keep the choice in. */
export function OnboardingCard({ data, qs, canDismiss }: { data: Onboarding; qs: string; canDismiss: boolean }) {
  const { busy, error, send } = useOnboardingPatch();
  // Shown while setup is incomplete — even when every remaining step is
  // hidden, so the way to bring them back never disappears with them.
  if (data.complete) return null;
  const next = data.upNext;
  return (
    <ChecklistCard
      title="Getting started"
      progress={{ done: data.done, total: data.total, style: "ring" }}
      busy={busy}
      hideLabel="Hide this step"
      actions={
        <Link href={withQs("/dashboard/welcome", qs)} className={buttonVariants({ size: "sm" })}>
          Resume setup
        </Link>
      }
      menuLabel="Getting started options"
      menu={
        canDismiss ? (
          <>
            {data.hidden.length > 0 && (
              <MenuItem onSelect={() => void send({ show: data.hidden })}>
                <Eye />
                Show hidden steps ({data.hidden.length})
              </MenuItem>
            )}
            <MenuItem onSelect={() => void send({ dismissed: true })}>
              <X />
              Hide getting started
            </MenuItem>
          </>
        ) : undefined
      }
      rows={data.steps
        .filter((s) => !s.hidden || s.done)
        .map((s) => ({
          key: s.id,
          label: s.title,
          icon: STEP_ICON[s.id],
          href: withQs(s.href, qs),
          done: s.done,
          hint: s.id === next?.id ? s.why : undefined,
          detail:
            s.id === next?.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link href={withQs(s.href, qs)} className={buttonVariants({ variant: "primary", size: "sm" })}>
                  {s.id === "workspace" ? "Start" : "Do it"}
                </Link>
                {s.cli && <code className="min-w-0 max-w-full truncate rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-fg-secondary">{s.cli}</code>}
              </div>
            ) : undefined,
          onHide: canDismiss && !s.done ? () => void send({ hide: [s.id] }) : undefined,
        }))}
      footer={
        error ? (
          <span role="alert" className="text-danger">{error}</span>
        ) : !next && data.hidden.length > 0 && canDismiss ? (
          <span className="flex flex-wrap items-center gap-2">
            Every step left is hidden.
            <button type="button" className={buttonVariants({ variant: "secondary", size: "xs" })} onClick={() => void send({ show: data.hidden })}>
              Show hidden steps ({data.hidden.length})
            </button>
          </span>
        ) : undefined
      }
    />
  );
}

/** The way back once hidden: one quiet line, only while steps remain. */
export function OnboardingReopen({ done, total }: { done: number; total: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await patchOnboarding({ dismissed: false });
        router.refresh();
      }}
      className="mt-6 text-sm text-fg-muted hover:text-fg"
    >
      Show getting started ({done} of {total})
    </button>
  );
}
