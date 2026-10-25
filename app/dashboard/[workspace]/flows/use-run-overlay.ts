"use client";

// The run the canvas draws over its nodes, kept current.
//
// Given a run id: a live run is followed over GET runs/<id>/stream — the
// same server-sent stream the live run panel reads (live-run.tsx), one
// socket for the run's life, closed by the server's `done`; a finished run
// the page did not hand us is read once with GET runs/<id>. What comes back
// is cut down to RunLite (flow-canvas-model.ts) before it is held, so a
// long run's events never sit in canvas state.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { liteRun, type RunLite } from "@/components/flow-canvas-model";
import { isRunTerminal } from "@/components/live-run-model";

type Link = "idle" | "live" | "reconnecting" | "closed";

export function useRunOverlay(workspace: string, tenant: string, runId: string | null, known: RunLite | null) {
  const router = useRouter();
  const [held, setHeld] = useState<RunLite | null>(known);
  const [link, setLink] = useState<Link>("idle");
  const [heldFor, setHeldFor] = useState<string | null>(runId);

  // A different run picked: start from what the page knew of it.
  if (heldFor !== runId) {
    setHeldFor(runId);
    setHeld(known);
  }
  // The page re-rendered with a newer snapshot of the same run (a refresh
  // after a start, a status change): take it when it is further along.
  if (known && held && known.id === held.id && known !== held && rank(known) > rank(held)) setHeld(known);

  const live = !!runId && (!held || !isRunTerminal(held.status as "completed"));
  const refresh = useRef(router.refresh);
  useEffect(() => {
    refresh.current = router.refresh;
  });

  useEffect(() => {
    if (!runId || !live) return;
    const q = tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : "";
    const source = new EventSource(`/api/workspaces/${workspace}/runs/${runId}/stream${q}`);
    source.onopen = () => setLink("live");
    let last = "";
    source.addEventListener("run", (e) => {
      try {
        const next = liteRun(JSON.parse((e as MessageEvent).data));
        setHeld(next);
        // A status change is news for the rest of the page — the card's
        // run dots, the cost line — so refresh once per transition.
        if (next.status !== last) {
          if (last) refresh.current();
          last = next.status;
        }
      } catch {
        // a partial frame; the next one supersedes it
      }
    });
    source.addEventListener("done", () => {
      source.close();
      setLink("closed");
      refresh.current();
    });
    source.onerror = () => setLink(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    return () => source.close();
  }, [workspace, tenant, runId, live]);

  // A picked finished run the page did not carry: read it once.
  useEffect(() => {
    if (!runId || known || held) return;
    let gone = false;
    fetch(`/api/workspaces/${workspace}/runs/${runId}`, { headers: { "x-foldrun-tenant": tenant } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const run = body?.run ?? body;
        if (!gone && run?.steps) setHeld(liteRun(run));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [workspace, tenant, runId, known, held]);

  return { run: runId ? held : null, link };
}

/** How far along a record is — terminal beats live, more settled steps
 *  beat fewer — so a stale snapshot never rolls the picture back. */
function rank(r: RunLite): number {
  const settled = r.steps.filter((s) => s.status !== "pending" && s.status !== "running").length;
  return (isRunTerminal(r.status as "completed") ? 1e6 : 0) + settled * 10 + r.steps.length;
}
