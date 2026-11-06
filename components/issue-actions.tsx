"use client";

// Acknowledge, snooze, resolve or reopen one issue (FOL-54 step 3), through
// POST /api/issues/<id> — the route the CLI's `foldrun issues` uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { needs, useCan } from "@/components/role";
import { openAssistant } from "@/components/assistant";
import type { IssueStatus } from "@/lib/issues";
import { AlarmClock, BellOff, CheckCircle2, Eye, MoreHorizontal, RotateCcw, Stethoscope } from "lucide-react";
import { Button } from "@/components/kit/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/kit/menu";
import { Tooltip } from "@/components/kit/tooltip";


/** `accountWide`: the caller may see every workspace. A platform issue is the
 *  account's, so only such a caller may act on it (the API refuses others).
 *  `doctor`: the issue's newest run, as core's issueDoctor puts it — Doctor
 *  opens the assistant in that run's workspace with the run page's question
 *  (FOL-22), so nothing is saved until a person saves the proposed fix. */
export function IssueActions({ id, status, tenant, platform = false, accountWide = true, doctor = null, compact = false }: { id: string; status: IssueStatus; tenant: string; platform?: boolean; accountWide?: boolean; doctor?: { workspace: string; prompt: string } | null; compact?: boolean }) {
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
  const open = status === "open" || status === "acknowledged";
  // One visible action, the rest behind "…" (the refactor's action rule):
  // Doctor when there is a run to read, else Resolve or Reopen.
  const showDoctor = !!doctor && status !== "resolved";
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {compact ? null : showDoctor ? (
        <Tooltip label={mayWrite ? "The assistant reads the latest run, says why and proposes the fix — nothing changes until you save it" : needs("workspace:write")}>
          <Button size="xs" disabled={!mayWrite} onClick={() => openAssistant(doctor!.prompt, doctor!.workspace)}>
            <Stethoscope />
            Doctor
          </Button>
        </Tooltip>
      ) : status !== "resolved" ? (
        <Tooltip label={title ?? "Close it; it opens again if it happens again"}>
          <Button size="xs" disabled={off} onClick={() => act("resolve")}>Resolve</Button>
        </Tooltip>
      ) : (
        <Button size="xs" disabled={off} title={title} onClick={() => act("reopen")}>Reopen</Button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label="More actions" disabled={busy}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent className="w-60">
          {compact && showDoctor && (
            <MenuItem disabled={!mayWrite} onSelect={() => openAssistant(doctor!.prompt, doctor!.workspace)}>
              <Stethoscope />
              <span className="flex flex-col"><span>Ask the doctor</span><span className="text-xs text-fg-muted">Reads the run, proposes the fix</span></span>
            </MenuItem>
          )}
          {status === "open" && (
            <MenuItem disabled={off} onSelect={() => act("acknowledge")}>
              <Eye />
              <span className="flex flex-col"><span>Acknowledge</span><span className="text-xs text-fg-muted">Seen; it stays open</span></span>
            </MenuItem>
          )}
          {open && (
            <MenuItem disabled={off} onSelect={() => act("snooze", { for: "1d" })}>
              <AlarmClock />
              <span className="flex flex-col"><span>Snooze for a day</span><span className="text-xs text-fg-muted">It comes back on its own</span></span>
            </MenuItem>
          )}
          {open && (
            <MenuItem disabled={off} onSelect={() => act("snooze", { times: 5 })}>
              <BellOff />
              <span className="flex flex-col"><span>Ignore the next 5</span><span className="text-xs text-fg-muted">For a known flake</span></span>
            </MenuItem>
          )}
          {(showDoctor || compact) && status !== "resolved" && (
            <MenuItem disabled={off} onSelect={() => act("resolve")}>
              <CheckCircle2 />
              <span className="flex flex-col"><span>Resolve</span><span className="text-xs text-fg-muted">It opens again if it happens again</span></span>
            </MenuItem>
          )}
          {status === "resolved" && compact && (
            <MenuItem disabled={off} onSelect={() => act("reopen")}>
              <RotateCcw />
              Reopen
            </MenuItem>
          )}
          {!allowed && <p className="px-2 py-1.5 text-xs text-fg-muted">{title}</p>}
        </MenuContent>
      </Menu>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
