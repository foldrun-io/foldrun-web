"use client";

// The version, where a person looks for it: a small line at the sidebar's
// foot linking to What's new, and a quiet notice when the platform under an
// open tab has been redeployed.
//
// The version a page was rendered with comes from the layout (the server
// read it), so "is there a newer one?" is a comparison of two facts, not a
// guess. The notice never reloads anything by itself — a reload loop on a
// mid-rollout box (two pods, two versions) is the failure it must not have.

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { buttonClass } from "./ui";

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
    <Link
      href={`/dashboard/whats-new${query}`}
      title="What's new in this version"
      className="mt-2 block truncate px-2 py-1 font-mono text-[10px] text-fg-subtle hover:text-fg-secondary"
    >
      foldrun {version}
    </Link>
  );
}

const POLL_MS = 5 * 60 * 1000;
const DISMISS_KEY = "foldrun:update-dismissed";

/** Every few minutes, and when the tab comes back: has /api/version moved? */
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
        const res = await fetch("/api/version", { cache: "no-store" });
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
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg-secondary shadow-lg"
    >
      <span>
        A new version of foldrun is out — <span className="font-mono text-xs text-fg">{newer}</span>.{" "}
        <Link href="/dashboard/whats-new" className="text-accent hover:underline">
          What&apos;s new
        </Link>
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={buttonClass("primary", "shrink-0")}
      >
        Reload
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-fg-subtle hover:text-fg-secondary">
        ×
      </button>
    </div>
  );
}
