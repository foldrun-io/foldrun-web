"use client";

// Acknowledge, snooze, resolve or reopen one issue (FOL-54 step 3), through
// POST /api/issues/<id> — the route the CLI's `foldrun issues` uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { needs, useCan } from "@/components/role";
import { openAssistant } from "@/components/assistant";
import type { IssueStatus } from "@/lib/issues";

const btn = "rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-50";

/** `accountWide`: the caller may see every workspace. A platform issue is the
 *  account's, so only such a caller may act on it (the API refuses others).
 *  `doctor`: the issue's newest run, as core's issueDoctor puts it — Doctor
 *  opens the assistant in that run's workspace with the run page's question
 *  (FOL-22), so nothing is saved until a person saves the proposed fix. */
export function IssueActions({ id, status, tenant, platform = false, accountWide = true, doctor = null }: { id: string; status: IssueStatus; tenant: string; platform?: boolean; accountWide?: boolean; doctor?: { workspace: string; prompt: string } | null }) {
  const router = useRouter();
  const role = useCan("run:start");
  const mayWrite = useCan("workspace:write");
  const allowed = role && (!platform || accountWide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: string, extra: Record<string, string | number> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const off = busy || !allowed;
  const title = allowed ? undefined : role ? "A platform issue is the account's — acting on it needs access to every workspace" : needs("run:start");
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {doctor && status !== "resolved" && (
        <button
          type="button"
          className={btn}
          disabled={!mayWrite}
          title={mayWrite ? "The run doctor: the assistant reads the latest run, says why and proposes the fix — nothing changes until you save it" : needs("workspace:write")}
          onClick={() => openAssistant(doctor.prompt, doctor.workspace)}
        >
          Doctor
        </button>
      )}
      {status === "open" && (
        <button type="button" className={btn} disabled={off} title={title ?? "Say you have seen it; it stays open"} onClick={() => act("acknowledge")}>Acknowledge</button>
      )}
      {(status === "open" || status === "acknowledged") && (
        <button type="button" className={btn} disabled={off} title={title ?? "Hide it for a day; it comes back on its own"} onClick={() => act("snooze", { for: "1d" })}>Snooze 1d</button>
      )}
      {(status === "open" || status === "acknowledged") && (
        <button type="button" className={btn} disabled={off} title={title ?? "Hide it until it happens five more times — for a known flake"} onClick={() => act("snooze", { times: 5 })}>Ignore next 5</button>
      )}
      {status !== "resolved" ? (
        <button type="button" className={btn} disabled={off} title={title ?? "Close it; it opens again if it happens again"} onClick={() => act("resolve")}>Resolve</button>
      ) : (
        <button type="button" className={btn} disabled={off} title={title} onClick={() => act("reopen")}>Reopen</button>
      )}
      {error && <span className="text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
