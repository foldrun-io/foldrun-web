"use client";

// The version, where a person looks for it: a small line at the sidebar's
// foot linking to What's new, and a quiet notice when the platform under an
// open tab has been redeployed.
//
// The version a page was rendered with comes from the layout (the server
// read it), so "is there a newer one?" is a comparison of two facts, not a
// guess. The notice never reloads anything by itself — a reload loop on a
// mid-rollout box (two pods, two versions) is the failure it must not have.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { Tooltip } from "@foldrun/ui/react/tooltip";

const VersionContext = createContext<string>("dev");

export function VersionProvider({ version, children }: { version: string; children: React.ReactNode }) {
  return <VersionContext.Provider value={version}>{children}</VersionContext.Provider>;
}

export const useVersion = () => useContext(VersionContext);

/** "foldrun v2026.10.01.3", small, at the sidebar's foot. Nothing when the rail is collapsed. */
export function VersionFooter({ collapsed, query = "" }: { collapsed?: boolean; query?: string }) {
  const version = useVersion();
  if (collapsed) return null;
  return (
    <Tooltip label={$t("components.version.whatSNewInThisVersion")}>
      <Link
        href={`/dashboard/whats-new${query}`}
        className="mt-2 block truncate px-2 py-1 font-mono text-[10px] text-fg-subtle hover:text-fg-secondary"
      >
        {$t("components.version.foldrun", { version: version })}
      </Link>
    </Tooltip>
  );
}

const POLL_MS = 5 * 60 * 1000;
const DISMISS_KEY = "foldrun:update-dismissed";

/** Every few minutes, and when the tab comes back: has /v1/version moved? */
export function UpdateToast({ pollMs = POLL_MS }: { pollMs?: number }) {
  const loaded = useVersion();
  const [newer, setNewer] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      // The tab coming back and the timer can land together; one ask is enough.
      if (Date.now() - last.current < 30_000) return;
      last.current = Date.now();
      try {
        const res = await fetch("/v1/version", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { version?: string };
        const v = body.version;
        if (stopped || !v || v === loaded) return;
        let dismissed: string | null = null;
        try {
          dismissed = sessionStorage.getItem(DISMISS_KEY);
        } catch {}
        if (dismissed !== v) setNewer(v);
      } catch {
        // A box mid-rollout refuses connections for a moment. Ask again later.
      }
    };
    const timer = setInterval(check, pollMs);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loaded, pollMs]);

  if (!newer) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, newer);
    } catch {}
    setNewer(null);
  };
  return (
    <div
      role="status"
      className="fixed bottom-4 end-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg-secondary shadow-lg"
    >
      <span>
        {$rich("components.version.aNewVersionOfFoldrunIs", { newer: newer, span: (chunks) => <span className="font-mono text-xs text-fg">{chunks}</span>, link: (chunks) => <Link href="/dashboard/whats-new" className="text-accent hover:underline">{chunks}</Link> })}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={cn(buttonVariants({ variant: "primary" }), "shrink-0")}
      >
        {$t("components.version.reload")}
      </button>
      <button type="button" onClick={dismiss} aria-label={$t("components.version.dismiss")} className="shrink-0 text-fg-subtle hover:text-fg-secondary">
        ×
      </button>
    </div>
  );
}
