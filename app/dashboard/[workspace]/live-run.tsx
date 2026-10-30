"use client";

// Live run trace. Seeded with the server-rendered run, then updated over SSE
// — so a running flow paints new events as they happen instead of waiting for
// a 2.5s full-page refresh. No spinner, no flicker, no re-render of the page
// around it.
//
// The stream is the source of truth while the run is live, gates included;
// a page refresh only ever brings the rest of the page (the table, the
// stats, the banner) up to the stream's view, never the other way round.
// The rules — what counts as live, which cards open, which record is newer
// — live in components/live-run-model.ts, where tests can reach them.

import { OperatorPanel } from "@/components/operator-panel";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { announceDecision } from "@/components/pending-approvals";
import { Badge, StatusBadge, TestBadge, VerdictBadge, buttonClass } from "@/components/ui";
import type { RunRecord } from "@/lib/store";
import { testEffects, testEffectSummary } from "@/components/test-run-model";

// Mirrored from store.ts#runDisplayStatus: this is a client component, and
// the store reads disk. One line; the queue test pins the original.
const runDisplayStatus = (r: Pick<RunRecord, "status" | "stopRequested">) =>
  r.status === "failed" && r.stopRequested ? "stopped" : r.status;
import { Markdown } from "@/components/markdown";
import { useConfirm } from "@/components/confirm";
import { useCan } from "@/components/role";
import { SmartTextarea } from "@/components/smart-textarea";
import { RunTimeline, traceEvents, stepSpan, fmtDur } from "@/components/run-timeline";
import { stepInputs, stepOutputs, fmtTokens, fmtBytes, fmtCached, fmtTokenDetail, fmtTokenLine, promptCacheNote, type StepRef, deniedPaths } from "@/components/step-io-model";
import { isRunTerminal, defaultUnfolded, activeStep, newer, tabTitle } from "@/components/live-run-model";
import type { RunOutputFile } from "@/lib/store";
import { BrowserTheater } from "@/components/run-browser";
import { stepImage, stepHeld, stepCredential, stepStartup, browserPodPanel, stepRefused } from "@/components/step-image-model";
import { RunTree } from "@/components/run-tree";
import { RunCompare } from "@/components/run-compare";
import { TraceView } from "@/components/trace-view";
import { EventWaitBox } from "@/components/event-wait-box";
import { LocalTime } from "@/components/local-time";
// Mirrored from store.ts#runVerdict, for the same reason.
const runVerdict = (r: Pick<RunRecord, "verdict" | "summary">) => {
  if (r.verdict !== undefined) return r.verdict;
  const m = /^(GOOD|BAD|QUIET|BLOCKED)(?![A-Za-z0-9_])/.exec((r.summary ?? "").replace(/^[\s#>*_`\-]+/, ""));
  return m ? m[1] : null;
};


/** A time the run's own record fixes — its latest event, else its start:
 *  what clock-drawn figures use until the page is hydrated. */
function runClock(run: RunRecord): number {
  let t = new Date(run.startedAt).getTime();
  for (const st of run.steps) for (const e of st.events) {
    const x = Date.parse(e.t);
    if (x > t) t = x;
  }
  return t;
}

function elapsed(run: RunRecord, now: number) {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  return (end - new Date(run.startedAt).getTime()) / 1000;
}

export function LiveRun({
  workspace,
  tenant,
  initial,
  outputs = [],
  compactHeader = false,
}: {
  /** On the run's own page the answer is already above: keep only the live
   *  signal and the actions here. */
  compactHeader?: boolean;
  workspace: string;
  tenant: string;
  initial: RunRecord;
  /** What the run archived from its agents' outputs/ — listed on the server,
   *  because the archive is written when the run finishes and the page is
   *  refreshed once at that moment. */
  outputs?: RunOutputFile[];
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [run, setRun] = useState<RunRecord>(initial);
  const [now, setNow] = useState(() => Date.now());
  // A live figure read off the clock is shown once hydrated: the server's
  // clock and the browser's differ by the time the page took, and the text
  // must match (a run waiting for room is live for a long time — 27 Oct 2026).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Until then, every figure drawn from the clock (the timeline, the trace
  // tree, a live step's span) is drawn at a time the run itself fixes — its
  // last event — so the server and the browser draw the same thing.
  const clock = hydrated || run.finishedAt ? now : runClock(run);
  const [busy, setBusy] = useState(false);
  // Erasing a run's record is workspace:manage (an admin), as the API asks.
  const mayErase = useCan("workspace:manage");
  // What the approver wants to say on the way through — guidance on approve,
  // reason on reject. Keyed by step so parallel gates don't share a box.
  const [notes, setNotes] = useState<Record<number, string>>({});
  // Which Out details are unfolded — the full answer, the whole JSON —
  // keyed "<step>:<what>" so parallel steps do not share a toggle.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  // Which step cards are unfolded. A long flow is a column of cards, and
  // the one a reader wants is the one that is happening: so by default only
  // the active step (running, or parked at a gate) is open, a finished step
  // folds to its header and headline, and the next step opens as it starts
  // (defaultUnfolded). A click pins a step either way — until its status
  // changes, which is when the default is worth more than the click:
  // "collapse all" on a live run still opens the next step as it starts.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const foldKey = (i: number, status: string) => `${i}:${status}`;
  const isUnfolded = (i: number): boolean => {
    const pinned = folded[foldKey(i, run.steps[i].status)];
    return pinned !== undefined ? !pinned : defaultUnfolded(run, i);
  };
  const toggleFold = (i: number) => {
    const key = foldKey(i, run.steps[i].status);
    const openNow = isUnfolded(i);
    setFolded((f) => ({ ...f, [key]: openNow }));
  };
  const foldAll = (fold: boolean) =>
    setFolded((f) => {
      const next = { ...f };
      run.steps.forEach((st, i) => { next[foldKey(i, st.status)] = fold; });
      return next;
    });
  // A card that just folded keeps its body mounted for the length of the
  // fold animation, then drops it. A folded card renders nothing heavy —
  // a fan-out run has a hundred cards and a hundred markdown traces is
  // not a page — but a body that vanished on the same frame the card
  // began to shrink was a jump, not a fold.
  const [closing, setClosing] = useState<Set<number>>(() => new Set());
  const wasUnfolded = useRef<boolean[]>([]);
  // Where "Save as eval" put the case — shown as a line under the header,
  // because a file path is a thing to read, not a thing to dismiss.
  const [promoted, setPromoted] = useState<{ file: string; created: boolean } | { error: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // The socket to the run, as the reader sees it: a dot beside the status.
  // "The page is stuck" has two causes that look the same — the stream
  // dropped, or the worker did — and the dot tells them apart.
  const [link, setLink] = useState<"connecting" | "live" | "reconnecting" | "closed">(
    isRunTerminal(initial.status) ? "closed" : "connecting",
  );
  // Whether the reader is at the foot of the page. Measured from the window
  // on every scroll — a person scrolling up anywhere on the page, table
  // included, has said "stop following" — and never assumed. It starts false:
  // opening a run must not throw the page to its bottom.
  const atPageBottom = useRef(false);
  // A step's trace box scrolls on its own inside the card. Each one follows
  // its tail while the reader leaves it at the bottom, and stops the moment
  // they scroll up inside it; boxes start stuck because they open at the tail.
  const boxRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const boxStuck = useRef<Map<number, boolean>>(new Map());
  const lastHeight = useRef(0);

  // A page refresh hands us the server's snapshot. Take it only if it is
  // at least as far along as what the stream has shown: the snapshot was
  // read a moment before it arrived, and while a run is moving that
  // moment is enough for it to be behind. (The key remounts this
  // component when the run itself changes.)
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    // Adjusting state to a changed prop, during render, as React asks.
    setSeen(initial);
    setRun((held) => newer(held, initial));
  }

  // Subscribe while the run is live — queued included, so the panel opened
  // right after "Run" shows the pickup instead of a frozen "queued"; gates
  // included, so approving a step paints the resume without a reload. One
  // socket for the run's whole life: the server ends it with `done` when
  // the run is over, and any other close (its 30-minute cap, a proxy, a
  // laptop lid) is the browser's cue to reconnect on its own.
  const subscribe = !isRunTerminal(initial.status);
  useEffect(() => {
    if (!subscribe) return;
    const source = new EventSource(
      `/api/workspaces/${workspace}/runs/${initial.id}/stream`,
    );
    source.onopen = () => setLink("live");
    source.addEventListener("run", (e) => {
      try {
        const next = JSON.parse((e as MessageEvent).data) as RunRecord;
        setRun((held) => newer(held, next));
      } catch {
        // ignore a partial frame; the next one supersedes it
      }
    });
    source.addEventListener("done", () => {
      source.close();
      setLink("closed");
    });
    // Not closed: EventSource retries by itself, and a healthy retry is
    // the difference between "the page is stuck" and a blip nobody saw.
    source.onerror = () => setLink(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    return () => source.close();
  }, [workspace, initial.id, subscribe]);

  // Every status the stream sees is a refresh for the rest of the page —
  // the row in the table, the stats, the approvals banner, and at the end
  // the archived outputs, all server-rendered. Once per transition, so a
  // quiet minute of tool calls costs the server nothing.
  const lastStatus = useRef(run.status);
  useEffect(() => {
    if (run.status === lastStatus.current) return;
    lastStatus.current = run.status;
    router.refresh();
  }, [run.status, router]);

  // The tab says where the run is, for whoever switched away to wait. The
  // framework owns <title> and writes the page's own back after every
  // refresh — and a refresh follows every transition — so this watches the
  // head and restores its line whenever that happens. The page's title
  // comes back when the panel goes.
  const pageTitle = useRef<string | null>(null);
  const wanted = tabTitle(run);
  useEffect(() => {
    if (pageTitle.current === null) pageTitle.current = document.title;
    const apply = () => { if (document.title !== wanted) document.title = wanted; };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [wanted]);
  useEffect(() => () => { if (pageTitle.current !== null) document.title = pageTitle.current; }, []);

  // Keep a card's body through its fold animation, then let it go.
  useEffect(() => {
    const now = run.steps.map((_, i) => isUnfolded(i));
    const justFolded = now.map((open, i) => !open && wasUnfolded.current[i] === true).flatMap((v, i) => (v ? [i] : []));
    wasUnfolded.current = now;
    if (justFolded.length === 0) return;
    setClosing((c) => new Set([...c, ...justFolded]));
    const t = setTimeout(() => setClosing((c) => {
      const n = new Set(c);
      for (const i of justFolded) n.delete(i);
      return n;
    }), 250);
    return () => clearTimeout(t);
    // Re-run whenever a fold could have changed: a click, or a status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folded, run]);

  // A ticking duration while live, so the trace and the timeline move
  // without touching the server. Waiting counts as live: the hatched bar at
  // a gate grows while a person decides, which is what waiting looks like.
  useEffect(() => {
    if (run.status !== "running" && run.status !== "awaiting-approval" && run.status !== "queued") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [run.status]);

  // A bar in the timeline is a link to its step's card.
  const showStep = (i: number) => {
    atPageBottom.current = false;
    setFolded((f) => ({ ...f, [foldKey(i, run.steps[i].status)]: false }));
    document.getElementById(`step-${run.id}-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // #step-3 in the address opens and shows that step — what a link from a
  // failure, an alert or a colleague's message points at.
  const showStepRef = useRef(showStep);
  useEffect(() => { showStepRef.current = showStep; });
  useEffect(() => {
    const open = () => {
      const m = window.location.hash.match(/^#step-(\d+)$/);
      const i = m ? Number(m[1]) - 1 : -1;
      if (i >= 0 && i < run.steps.length) setTimeout(() => showStepRef.current(i), 50);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run
  }, [run.id]);

  useEffect(() => {
    const measure = () => {
      const doc = document.documentElement;
      atPageBottom.current = doc.scrollHeight - (window.scrollY + window.innerHeight) < 48;
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    return () => window.removeEventListener("scroll", measure);
  }, []);

  // Selecting a run from the table lands its panel below the fold. Bring
  // its top into view once, on open — and only if it is actually out of
  // sight, so re-opening a run already on screen moves nothing.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight - 120 || top < 0) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Once per run: the key remounts this component when the run changes.
  }, []);

  // Follow the tail — but only when there is a tail to follow. Three things
  // have to be true: the run is still producing, the page actually grew (an
  // identical frame, or a tick of the clock, moves nothing), and the reader
  // was already at the bottom. Anyone who has scrolled up stays put.
  const live = !isRunTerminal(run.status);
  useEffect(() => {
    for (const [i, el] of boxRefs.current) {
      if (boxStuck.current.get(i) ?? true) el.scrollTop = el.scrollHeight;
    }
    const height = document.documentElement.scrollHeight;
    const grew = height > lastHeight.current;
    lastHeight.current = height;
    if (live && grew && atPageBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [run, live]);

  const totalCost = run.steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  // Which step's "edit & re-run" box is open, and its draft.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  // Re-run the flow from one step, as a new run — the fix for "one step
  // failed, the rest was fine". The panel swaps to the new run when it lands.
  // `instruction`: what that step is told this once (FOL-72 step 6) — try a
  // fix on the real input before writing it into the flow.
  const rerun = async (step: number, instruction?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/runs/${run.id}/rerun`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ step: step + 1, ...(instruction !== undefined ? { instruction } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { runId?: string };
      if (res.ok && data.runId) {
        router.push(
          `/dashboard/${workspace}/runs/${data.runId}${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const finished = run.status === "completed" || run.status === "failed";
  // Failed, BLOCKED or BAD: its own answer is not the one to keep.
  const wentWrong = run.status === "failed" || (run.status === "completed" && ["BAD", "BLOCKED"].includes(runVerdict(run) ?? ""));
  const [shouldOpen, setShouldOpen] = useState(false);
  const [should, setShould] = useState("");

  // A run that worked is the best test of what did it: its task and its
  // conclusion become a case in evals/<target>-regressions.md, so the next
  // edit that changes the answer fails a test instead of a customer.
  // `should`: for a run that went wrong, what it should have done — the
  // judge's claim for the case (FOL-72 step 10).
  const promote = async (should?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/runs/${run.id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify(should ? { should } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as { file?: string; created?: boolean; error?: string };
      if (res.ok && data.file) {
        setPromoted({ file: data.file, created: Boolean(data.created) });
        router.refresh();
      } else {
        setPromoted({ error: data.error ?? `could not save (${res.status})` });
      }
    } finally {
      setBusy(false);
    }
  };

  // Stop what is running; erase what is finished. Deliberately one slot that
  // changes meaning with the run's state rather than two buttons that are
  // wrong half the time — you cannot stop a finished run, and deleting a
  // live one would strand its sandbox.
  const stop = async () => {
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${workspace}/runs/${run.id}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      });
      // A stopped run is no longer waiting on anyone either.
      announceDecision(run.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({
      title: `Delete run ${run.id}?`,
      body: "Its trace and archived outputs are erased. The ledger keeps what it cost.",
      confirmLabel: "Delete",
    }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/runs/${run.id}`, {
        method: "DELETE",
        headers: { "x-foldrun-tenant": tenant },
      });
      if (res.ok) {
        router.push(
          `/dashboard/${workspace}/runs${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approve" | "reject", step: number) => {
    setBusy(true);
    try {
      const note = (notes[step] ?? "").trim();
      await fetch(`/api/workspaces/${workspace}/runs/${run.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({
          decision,
          step,
          // The same words serve both verbs: guidance if the step proceeds,
          // the reason on the record if it doesn't.
          ...(note ? (decision === "approve" ? { note } : { reason: note }) : {}),
        }),
      });
      // The stream stays open through a gate and paints the resume itself;
      // a refresh here would only hand the panel a snapshot from before the
      // worker moved. The banner is a separate poll and would otherwise
      // keep asking for 20 more seconds.
      announceDecision(run.id, step);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="scroll-mt-4 space-y-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {!compactHeader && (<>
          <span className="font-mono">{run.id}</span>
          <span className="text-gray-300">·</span>
          <span className="font-medium text-fg-secondary">{run.flow}</span>
          <StatusBadge status={runDisplayStatus(run)} />
          {run.status === "completed" && <VerdictBadge verdict={runVerdict(run)} />}
        </>)}
        {run.test && <TestBadge />}
        {live && (
          <button
            type="button"
            onClick={() => { const i = activeStep(run); if (i >= 0) showStep(i); }}
            title={
              link === "live" ? "Live — updates arrive as the run writes them. Click to jump to the active step."
              : link === "reconnecting" ? "Stream dropped — reconnecting. The run is still going; the page catches up when it does."
              : link === "connecting" ? "Connecting to the run…"
              : "Stream closed"
            }
            className="flex items-center gap-1 rounded text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                link === "live" ? "animate-pulse bg-emerald-500"
                : link === "reconnecting" ? "bg-amber-500"
                : link === "connecting" ? "animate-pulse bg-gray-300"
                : "bg-gray-300"
              }`}
            />
            <span className="text-fg-subtle">{link === "live" ? "live" : link === "reconnecting" ? "reconnecting" : link === "connecting" ? "connecting" : "closed"}</span>
          </button>
        )}
        {(!compactHeader || live) && <span className="tabular-nums">{run.finishedAt || hydrated ? `${elapsed(run, clock).toFixed(1)}s` : "…"}</span>}
        {!compactHeader && totalCost > 0 && <span className="tabular-nums">${totalCost.toFixed(4)}</span>}
        <a
          href={`/api/workspaces/${encodeURIComponent(workspace)}/runs/${run.id}`}
          target="_blank"
          rel="noreferrer"
          title="The run record as the runner wrote it — every event, every stamp"
          className="font-mono text-fg-subtle hover:text-fg-secondary hover:underline"
        >
          json
        </a>
        <span className="ml-auto flex items-center gap-2">
          {!finished && (
            <button onClick={() => void stop()} disabled={busy} className={buttonClass("destructive")}>
              Stop run
            </button>
          )}
          {run.status === "completed" && !wentWrong && (
            <button
              onClick={() => void promote()}
              disabled={busy}
              title="Write this run's task and conclusion into evals/ as a regression case"
              className={buttonClass("secondary")}
            >
              Save as eval
            </button>
          )}
          {finished && wentWrong && (
            <button
              onClick={() => setShouldOpen((v) => !v)}
              disabled={busy}
              aria-expanded={shouldOpen}
              title="Write this run's task into evals/ with what it should have done, so the fix stays fixed"
              className={buttonClass("secondary")}
            >
              Turn into a test
            </button>
          )}
          {finished && mayErase && (
            <button onClick={() => void remove()} disabled={busy} className={buttonClass("minimal")}>
              Delete
            </button>
          )}
        </span>
      </div>
      {shouldOpen && wentWrong && (
        <div className="rounded-lg border border-line bg-sunken p-2">
          <label htmlFor="should" className="block text-[11px] text-fg-muted">
            What should it have done? A judge holds the next run of this task to it — the case goes into evals/.
          </label>
          <textarea id="should" value={should} onChange={(e) => setShould(e.target.value)} rows={3} placeholder="e.g. finds the two newest filings and quotes their dates" className="mt-1 w-full rounded border border-line bg-surface p-1.5 text-xs text-fg" />
          <div className="mt-1 flex items-center gap-2">
            <button onClick={() => void promote(should.trim())} disabled={busy || !should.trim()} className={buttonClass("primary", "px-2.5 py-1 text-xs disabled:opacity-50")}>
              save the test
            </button>
            <button onClick={() => setShouldOpen(false)} className="text-xs text-fg-muted hover:text-fg">cancel</button>
          </div>
        </div>
      )}
      {run.test && (() => {
        // The receipts: what this run would have done. Read off the events
        // that carry an effect, so the panel is the record and not a second
        // account of it. Nothing here is live until the run is re-run
        // without the checkbox.
        const effects = testEffects(run);
        return (
          <section className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <p className="font-medium">
              Test run — {testEffectSummary(effects)}.{" "}
              <span className="font-normal text-blue-800">
                Every step ran against the real files and real read APIs; nothing outward happened, and state/ and storage/ were left as they were.
              </span>
            </p>
            {effects.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
                {effects.map((e, i) => (
                  <li key={i}>
                    <span className="text-blue-500">step {e.step} · {e.agent} · {e.kind}</span>{" "}
                    {e.method && e.host ? `${e.method} ${e.host}${e.path ?? ""} — ` : ""}
                    {e.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}
      {run.memoryWrites && run.memoryWrites.length > 0 && (
        <p className="text-xs text-fg-muted">
          Remembered:{" "}
          {run.memoryWrites.map((rel, i) => (
            <span key={rel}>
              {i > 0 && ", "}
              <a
                href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(rel)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`}
                className="font-mono text-fg-secondary hover:underline"
              >
                {rel}
              </a>
            </span>
          ))}
        </p>
      )}
      {promoted && (
        <p className={`text-xs ${"error" in promoted ? "text-red-600" : "text-fg-muted"}`}>
          {"error" in promoted ? (
            promoted.error
          ) : (
            <>
              {promoted.created ? "Created " : "Added a case to "}
              <a
                href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(promoted.file)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`}
                className="font-mono text-fg-secondary hover:underline"
              >
                {promoted.file}
              </a>
            </>
          )}
        </p>
      )}

      {run.steps.length > 0 && <RunTimeline run={run} now={clock} onSelect={showStep} />}

      {run.steps.length > 0 && <RunTree run={run} workspace={workspace} tenant={tenant} now={clock} />}
      {finished && run.steps.length > 0 && <RunCompare workspace={workspace} runId={run.id} tenant={tenant} />}

      {run.steps.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <span>{run.steps.length} steps</span>
          <span className="text-gray-300">·</span>
          <button type="button" onClick={() => foldAll(false)} className="rounded hover:text-fg-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
            expand all
          </button>
          <span className="text-gray-300">·</span>
          <button type="button" onClick={() => foldAll(true)} className="rounded hover:text-fg-secondary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
            collapse all
          </button>
          {live && (
            <span className="text-gray-300"> — the step that starts next opens on its own</span>
          )}
        </div>
      )}

      {run.steps.map((step, i) => {
        const unfolded = isUnfolded(i);
        const foldedHeadline = unfolded ? null : stepOutputs(step).headline ?? null;
        const span = stepSpan(step, clock);
        const tokens = step.tokens ? step.tokens.input + step.tokens.output : 0;
        return (
        <div key={i} id={`step-${run.id}-${i}`} className="scroll-mt-4 rounded-xl border border-line bg-surface p-4">
          <div className={`flex items-center justify-between gap-2 text-sm ${unfolded ? "mb-2" : ""}`}>
            <button
              type="button"
              onClick={() => toggleFold(i)}
              aria-expanded={unfolded}
              title={unfolded ? "Fold this step" : "Unfold this step"}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
            >
              <span className={`inline-block w-3 shrink-0 text-[10px] text-fg-subtle transition-transform ${unfolded ? "rotate-90" : ""}`} aria-hidden>
                ▶
              </span>
              <span className="min-w-0 truncate">
                <span className="text-fg-subtle">step {i + 1}</span>
                <span className="text-gray-300"> · </span>
                <span className="font-medium text-fg">{step.agent}</span>
                {/* sandbox: own — a job another step handed this agent; it ran
                    in its own sandbox and only its reply went back. */}
                {step.subagentOf && (
                  <span className="ml-1.5 text-xs text-fg-subtle" title="a sub-agent with sandbox: own — its own sandbox, tools, secrets and network; only its reply went back">
                    ↳ job from {step.subagentOf} · own sandbox
                  </span>
                )}
                {step.optional && !step.subagentOf && <span className="ml-1.5 text-xs text-fg-subtle">optional</span>}
                {step.delegations?.length ? (
                  <span className="ml-1.5 text-xs text-fg-subtle" title="jobs this step handed to sub-agents with sandbox: own">
                    handed{" "}
                    {step.delegations
                      .map((d) => {
                        const at = run.steps.findIndex((s) => s.delegation === d.id);
                        return `${d.agent} (${at >= 0 ? `step ${at + 1}, ` : ""}${d.status})`;
                      })
                      .join(", ")}
                  </span>
                ) : null}
                {step.approve && <span className="ml-1.5 text-xs text-amber-600">needs approval</span>}
                {(step.attempts ?? 0) > 1 && (
                  <span className="ml-1.5 text-xs text-fg-subtle">attempt {step.attempts}</span>
                )}
                {/* Which runner image the step ran on — "slim · browser pod"
                    when it browsed through the account's pod from slim. */}
                {(() => {
                  const im = stepImage(step);
                  return im ? (
                    <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-fg-subtle" title={im.title}>
                      {im.label}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const held = stepHeld(step);
                  return held ? (
                    <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] tabular-nums text-fg-subtle" title={held.title}>
                      {held.label}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const up = stepStartup(step);
                  return up ? (
                    <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] tabular-nums text-fg-subtle" title={up.title}>
                      {up.label}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const cred = stepCredential(step);
                  return cred ? (
                    <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-fg-subtle" title={cred.title}>
                      {cred.label}
                    </span>
                  ) : null;
                })()}
                {foldedHeadline && (
                  <span className="ml-2 text-xs text-fg-muted">{foldedHeadline}</span>
                )}
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-2">
              {/* The header is the summary: how long, how many tokens, how
                  much — so a folded column still answers "where did the
                  time and the money go" without opening a card. */}
              {span && (
                <span className="tabular-nums text-xs text-fg-subtle" title={span.live ? "running for" : "took"}>
                  {span.live && !hydrated ? "…" : fmtDur(span.end - span.start)}
                </span>
              )}
              {tokens > 0 && (
                <span className="tabular-nums text-xs text-fg-subtle" title={fmtTokenDetail(step.tokens) ?? undefined}>
                  {fmtTokens(tokens)} tok{fmtCached(step.tokens) ? ` · ${fmtCached(step.tokens)}` : ""}
                </span>
              )}
              {step.costUsd != null && (
                <span className="tabular-nums text-xs text-fg-subtle">
                  ${step.costUsd.toFixed(4)}
                </span>
              )}
              {/* Steps before this one are carried with their results; this
                  one and everything after runs again — later steps consumed
                  the earlier results, so a partial re-run would ship stale
                  work. Only on a finished run: a live one is still deciding. */}
              {finished && (
                <button
                  onClick={() => void rerun(i)}
                  disabled={busy}
                  title="Start a new run: earlier steps carried as context, this step and later ones run again"
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-fg-subtle ring-1 ring-inset ring-line transition-colors hover:bg-sunken hover:text-fg-secondary"
                >
                  re-run from here
                </button>
              )}
              {finished && (
                <button
                  onClick={() => {
                    setDraft(step.instruction ?? "");
                    setEditing(editing === i ? null : i);
                  }}
                  disabled={busy}
                  aria-expanded={editing === i}
                  title="Re-run from here with a different instruction for this step, this once — the flow file is not changed"
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-fg-subtle ring-1 ring-inset ring-line transition-colors hover:bg-sunken hover:text-fg-secondary"
                >
                  edit &amp; re-run
                </button>
              )}
              <StatusBadge
                status={step.skipReason === "run stopped" ? "stopped" : (step.status === "pending" || step.status === "running") && step.roomWait ? "waiting for room" : step.status}
              />
            </span>
          </div>

          {editing === i && (
            <div className="mx-3 mb-2 rounded-lg border border-line bg-sunken p-2">
              <label className="block text-[11px] text-fg-muted" htmlFor={`edit-${i}`}>
                This step&apos;s instruction for one re-run — the flow file is not changed. Earlier steps are carried as context.
              </label>
              <textarea
                id={`edit-${i}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded border border-line bg-surface p-1.5 font-mono text-xs text-fg"
              />
              <div className="mt-1 flex items-center gap-2">
                <button
                  onClick={() => void rerun(i, draft)}
                  disabled={busy || !draft.trim()}
                  className={buttonClass("primary", "px-2.5 py-1 text-xs disabled:opacity-50")}
                >
                  re-run with this
                </button>
                <button onClick={() => setEditing(null)} className="text-xs text-fg-muted hover:text-fg">
                  cancel
                </button>
              </div>
            </div>
          )}

          {/* The body folds by animating the grid row it sits in from its
              full height to nothing — the one height animation CSS can do
              without knowing the height. */}
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${unfolded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="min-h-0 overflow-hidden">
          {(unfolded || closing.has(i)) && (<>
          <OperatorPanel workspace={workspace} tenant={tenant} runId={run.id} step={step} stepIndex={i} />
          {/* The account's browser pod under a slim step: its reconnects,
              and — when it was lost — the re-run on full or why not. */}
          {(() => {
            // The slim go the pod was lost under is a try of its own:
            // slim (lost), then full, each with what it cost. The tries show
            // even when the last attempt left no pod note (a retry on full).
            const pod = browserPodPanel(step);
            if (!pod) return null;
            const tone = pod.tone === "bad" ? "border-red-200 bg-red-50 text-red-800" : pod.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-sunken text-fg-secondary";
            return (
              <p className={`mb-3 rounded-md border px-3 py-1.5 text-xs ${tone}`}>
                {pod.line && (
                  <span className="block">
                    <span className="font-medium">Browser pod:</span> {pod.line}
                  </span>
                )}
                {pod.tries && (
                  <span className={pod.line ? "mt-0.5 block" : "block"}>
                    <span className="font-medium">Tries:</span> {pod.tries}
                  </span>
                )}
              </p>
            );
          })()}
          {/* Configuration or code the step changed and the copy-back
              refused (FOL-96): named, so nobody wonders where the edit went. */}
          {(() => {
            const refused = stepRefused(step);
            if (!refused) return null;
            return (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                <span className="block"><span className="font-medium">Not kept:</span> {refused.line}</span>
                <span className="mt-0.5 block font-mono">{refused.paths.join(", ")}</span>
              </div>
            );
          })()}
          {/* Waiting for room to start (27 Oct 2026): no time limit, its
              place in line kept, nothing charged meanwhile. */}
          {(step.status === "pending" || step.status === "running") && step.roomWait && (
            <div className="mb-3 rounded-lg border border-info-line bg-info-soft px-3 py-2 text-xs text-fg-secondary">
              <span className="block font-medium text-info">
                Waiting for room to start{run.status === "queued" ? " — the run waits in the queue" : ""}, since <LocalTime iso={step.roomWait.since} />
              </span>
              <span className="block">
                {step.roomWait.why}. It needs {step.roomWait.cpus} vCPU · {step.roomWait.memGiB} GiB{step.roomWait.diskGiB ? ` · ${step.roomWait.diskGiB} GiB disk` : ""}, starts in turn when there is room, and is not charged while it waits.
              </span>
            </div>
          )}
          {/* A `wait: event` step waits on the outside world, not a person:
              its own box, with the URL that releases it and a payload. */}
          {step.status === "awaiting-approval" && step.waitFor === "event" && (
            <EventWaitBox workspace={workspace} tenant={tenant} runId={run.id} index={i} step={step} />
          )}
          {step.status === "awaiting-approval" && step.waitFor !== "event" && (
            <div className="mb-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="block text-xs font-medium text-amber-900">
                {step.ask ? `This step asks you: ${step.ask}` : "Waiting for you before this step runs."}
              </span>
              {run.test && (
                <span className="block text-xs text-amber-800">
                  This is a test run: approving lets the step run, but nothing it sends will go out and nothing it writes to state/ will be kept.
                </span>
              )}
              {/* What is being approved, in full, where the decision is made.
                  A gate that showed only its question sent the approver
                  scrolling through earlier steps' traces to find the post,
                  the email, the commit — and a run's first approval was
                  given without reading it. The material is the results the
                  step will receive (the nearest earlier group's replies) and
                  its instruction; rendered, not linked. */}
              {(() => {
                const gate = stepInputs(run.steps, i);
                const material = gate.results
                  ? gate.results.from
                      .map((ref) => ({ ref, text: run.steps[ref.index]?.result ?? "" }))
                      .filter((m) => m.text.trim())
                  : [];
                // Files the gate's question or its material name under
                // storage/ — a thumbnail a step is about to publish, or the
                // proposal a step is about to apply — are shown, not linked:
                // "the brief is at storage/proposal.md, reply GO" used to
                // send the approver to another page to read what they were
                // approving. Pictures render as pictures, text files as
                // markdown, from the store, which serves both inline.
                // Declared first (`preview:` on the step, resolved when the run
                // parked), then whatever the question or the material names.
                const named = `${step.ask ?? ""}\n${material.map((m) => m.text).join("\n")}`;
                const declared = step.previewFiles ?? [];
                const isImage = (p: string) => /\.(?:jpe?g|png|webp|gif)$/i.test(p);
                const isDoc = (p: string) => /\.(?:mdx?|txt|csv|json)$/i.test(p);
                const images = Array.from(new Set([
                  ...declared.filter(isImage),
                  ...Array.from(named.matchAll(/(?:\.\.\/\.\.\/)?storage\/([\w./-]+?\.(?:jpe?g|png|webp|gif))\b/gi), (m) => m[1]),
                ])).slice(0, 6);
                const docs = Array.from(new Set([
                  ...declared.filter(isDoc),
                  ...Array.from(named.matchAll(/(?:\.\.\/\.\.\/)?storage\/([\w./-]+?\.(?:mdx?|txt|csv|json))\b/gi), (m) => m[1]),
                ])).slice(0, 4);
                const imageSrc = (rel: string) =>
                  `/api/workspaces/${encodeURIComponent(workspace)}/storage/download?path=${encodeURIComponent(rel)}&inline=1`;
                return (
                  <div className="rounded-md border border-amber-200 bg-surface px-3 py-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-800">
                      What this step will act on
                    </div>
                    {gate.instruction && (
                      <p className="mb-2 text-xs italic text-fg-tertiary">{gate.instruction}</p>
                    )}
                    {images.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-3">
                        {images.map((rel) => (
                          <figure key={rel} className="max-w-xs">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a workspace file, not a static asset */}
                            <img src={imageSrc(rel)} alt={rel} className="rounded border border-line" />
                            <figcaption className="mt-1 font-mono text-[11px] text-fg-muted">{rel}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    {docs.map((rel) => (
                      <GateDocument key={rel} workspace={workspace} tenant={tenant} rel={rel} src={imageSrc(rel)} />
                    ))}
                    {material.length === 0 ? (
                      <p className="text-xs text-fg-subtle">No earlier result reaches this step; it runs on its instruction alone.</p>
                    ) : (
                      <div className="space-y-3">
                        {material.map(({ ref, text }) => (
                          <div key={ref.index}>
                            <div className="mb-1 text-[11px] text-fg-muted">
                              step {ref.index + 1} · {ref.agent}
                              {ref.item && <span className="text-fg-subtle"> ({ref.item.slice(0, 60)})</span>}
                            </div>
                            <div className="max-h-[32rem] overflow-y-auto rounded border border-line-faint bg-sunken px-3 py-2">
                              <Markdown text={text} className="text-sm text-gray-800" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* The gate is also where you steer: anything typed here reaches
                  the step as operator guidance if approved, or lands on the
                  record as the reason if rejected.

                  A SmartTextarea, because what is typed here is expanded the
                  same way a step's instruction is — [[dead-ends]] becomes a
                  path before the model sees it. Offering the completions is
                  what makes that discoverable; without them the one syntax
                  the workspace teaches was missing at the one moment a person
                  is actually writing an instruction by hand. `path` is a flow
                  so the vocabulary is a flow's. */}
              <SmartTextarea
                workspace={workspace}
                tenant={tenant}
                path={`flows/${run.flow ?? "flow"}.md`}
                value={notes[i] ?? ""}
                onChange={(next) => setNotes((n) => ({ ...n, [i]: next }))}
                placeholder={step.ask ? "Your answer — it reaches the step as its instruction" : "Optional: guidance for this step if you approve — or why, if you reject"}
                rows={2}
                className="w-full rounded-md border border-amber-200 bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-amber-400 focus:outline-none"
              />
              <span className="flex items-center justify-end gap-2">
                <button
                  onClick={() => decide("approve", i)}
                  disabled={busy}
                  className={buttonClass("primary")}
                >
                  Approve
                </button>
                <button
                  onClick={() => decide("reject", i)}
                  disabled={busy}
                  className={buttonClass("destructive")}
                >
                  Reject
                </button>
              </span>
            </div>
          )}

          {/* What went in and what came out, as facts beside each other —
              the trace below is the working, this is the answer to "what
              did this step do" without reading it. Both columns come from
              the record (step-io-model.ts); the files come from the archive
              the run wrote when it finished. */}
          {(() => {
            const io = stepInputs(run.steps, i);
            const out = stepOutputs(step);
            const files = outputs.filter((f) => f.agent === step.agent);
            const span = stepSpan(step, clock);
            const durationMs = span ? span.end - span.start : null;
            const stepLive = step.status === "running";
            const notYet = step.status === "pending" || step.status === "awaiting-approval";
            const jsonText = out.data !== undefined ? JSON.stringify(out.data, null, 2) : null;
            const jsonLines = jsonText ? jsonText.split("\n") : [];
            const jsonOpen = open[`${i}:data`] ?? false;
            const answerOpen = open[`${i}:answer`] ?? false;
            const stepLink = (ref: StepRef, j: number) => (
              <span key={ref.index}>
                {j > 0 && ", "}
                <button
                  type="button"
                  onClick={() => showStep(ref.index)}
                  className="font-medium text-fg-secondary underline-offset-2 hover:underline"
                >
                  step {ref.index + 1} · {ref.agent}
                </button>
                {ref.item && <span className="text-fg-subtle"> ({ref.item.slice(0, 40)})</span>}
              </span>
            );
            // Path refusals are shown as a number because each one is a
            // wasted turn: an agent that reaches outside its workspace fifteen
            // times is one that does not know where it is, and the fix is a
            // path in its prompt, not a bigger model.
            const denied = deniedPaths(step);
            const usage = [
              step.costUsd != null ? `$${step.costUsd.toFixed(4)}` : null,
              fmtTokenLine(step.tokens),
              typeof step.turns === "number" ? `${step.turns} turn${step.turns === 1 ? "" : "s"}` : null,
              durationMs != null && durationMs > 0 ? fmtDur(durationMs) : null,
              denied ? `${denied} path${denied === 1 ? "" : "s"} refused` : null,
            ].filter(Boolean);
            // A step that wrote much of its input to the prompt cache says
            // which layer of its prompt changed since the agent's last step
            // — "memory changed" — instead of leaving a person to guess.
            const cacheNote = promptCacheNote(run.steps, i);
            return (
              <div>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <IoPanel label="In">
                  <IoRow k="instruction">
                    {io.instruction ? (
                      <span className="italic text-fg-tertiary">{io.instruction}</span>
                    ) : (
                      <span className="text-fg-subtle">none — the agent runs on its own instructions</span>
                    )}
                  </IoRow>
                  {io.item && <IoRow k="item">{io.item}</IoRow>}
                  <IoRow k="results of">
                    {io.results ? (
                      io.results.from.map(stepLink)
                    ) : (
                      <span className="text-fg-subtle">{io.first ? "nothing — first group" : "nothing — no earlier step produced a result"}</span>
                    )}
                  </IoRow>
                  {io.data && <IoRow k="data from">{io.data.from.map(stepLink)}</IoRow>}
                  {io.event && (
                    <IoRow k="event">
                      <span className="break-all font-mono text-[11px]" title={io.event}>
                        {io.event.length > 200 ? `${io.event.slice(0, 199)}…` : io.event}
                      </span>
                    </IoRow>
                  )}
                  {io.note && (
                    <IoRow k={io.ask ? "answer" : "guidance"}>
                      {io.ask && <span className="text-fg-subtle">to “{io.ask}”: </span>}
                      {io.note}
                    </IoRow>
                  )}
                  {io.carriedFrom && (
                    <IoRow k="carried">
                      <span className="text-fg-subtle">from run </span>
                      <span className="font-mono">{io.carriedFrom}</span>
                      <span className="text-fg-subtle"> — not run again</span>
                    </IoRow>
                  )}
                </IoPanel>
                <IoPanel label="Out">
                  {out.skipReason && <IoRow k="skipped">{out.skipReason}</IoRow>}
                  {stepLive && (
                    <IoRow k="headline">
                      <span className="text-amber-600">working…</span>
                    </IoRow>
                  )}
                  {notYet && !out.skipReason && (
                    <IoRow k="headline">
                      <span className="text-fg-subtle">not yet run</span>
                    </IoRow>
                  )}
                  {out.headline && !stepLive && (
                    <IoRow k="headline">
                      <span className="text-fg">{out.headline}</span>
                      {out.answer && (
                        <button
                          type="button"
                          onClick={() => toggle(`${i}:answer`)}
                          className="ml-2 text-[11px] font-medium text-fg-muted underline-offset-2 hover:underline"
                        >
                          {answerOpen ? "hide full answer" : "full answer"}
                        </button>
                      )}
                      {out.answer && answerOpen && (
                        <div className="mt-1.5 max-h-72 overflow-auto rounded border border-line-faint bg-sunken px-2 py-1.5">
                          <Markdown text={out.answer} className="text-gray-800" />
                        </div>
                      )}
                    </IoRow>
                  )}
                  {jsonText && (
                    <IoRow k="data">
                      <pre className="max-h-72 overflow-auto rounded border border-line-faint bg-sunken px-2 py-1.5 font-mono text-[11px] leading-snug text-gray-800">
                        {jsonOpen || jsonLines.length <= 12 ? jsonText : jsonLines.slice(0, 12).join("\n")}
                      </pre>
                      {jsonLines.length > 12 && (
                        <button
                          type="button"
                          onClick={() => toggle(`${i}:data`)}
                          className="mt-1 text-[11px] font-medium text-fg-muted underline-offset-2 hover:underline"
                        >
                          {jsonOpen ? "show less" : `show all ${jsonLines.length} lines`}
                        </button>
                      )}
                    </IoRow>
                  )}
                  {files.length > 0 && (
                    <IoRow k="files">
                      <ul className="space-y-0.5">
                        {files.map((f) => (
                          <li key={f.path} className="truncate">
                            <a
                              href={`/api/workspaces/${workspace}/runs/${run.id}/archive?agent=${encodeURIComponent(f.agent)}&path=${encodeURIComponent(f.path)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[11px] text-fg-secondary underline-offset-2 hover:underline"
                            >
                              {f.path}
                            </a>
                            <span className="ml-1.5 text-[10px] tabular-nums text-fg-subtle">{fmtBytes(f.bytes)}</span>
                          </li>
                        ))}
                      </ul>
                    </IoRow>
                  )}
                  {out.error && (
                    <IoRow k="error">
                      <span className="text-red-600">{out.error}</span>
                    </IoRow>
                  )}
                  {usage.length > 0 && (
                    <IoRow k="usage">
                      <span className="tabular-nums text-fg-muted">{usage.join(" · ")}</span>
                    </IoRow>
                  )}
                  {cacheNote && (
                    <IoRow k="prompt cache">
                      <span className="text-fg-muted">{cacheNote}</span>
                    </IoRow>
                  )}
                  {(step.calls?.length ?? 0) > 0 && (
                    <IoRow k="model calls">
                      <details>
                        <summary className="cursor-pointer text-fg-muted hover:text-fg">
                          {step.calls!.length} call{step.calls!.length === 1 ? "" : "s"} · slowest {fmtDur(Math.max(...step.calls!.map((c) => c.ms)))} · largest {fmtCount(Math.max(...step.calls!.map((c) => c.tokens.input)))} in
                        </summary>
                        <ol className="mt-1 space-y-0.5 font-mono text-[11px] tabular-nums text-fg-muted">
                          {step.calls!.map((c) => (
                            <li key={c.id} title={c.id}>
                              {c.n}. {c.model ?? "model"}
                              {c.subagent ? ` ↳ ${c.subagent}` : ""} · {fmtDur(c.ms)} · {fmtCount(c.tokens.input)} in
                              {c.tokens.input > 0 && c.tokens.cacheRead > 0 ? ` (${Math.round((100 * c.tokens.cacheRead) / c.tokens.input)}% cached)` : ""} · {fmtCount(c.tokens.output)} out
                              {c.stop ? ` · ${c.stop}` : ""}
                              {c.tools ? ` · ${c.tools} tool${c.tools === 1 ? "" : "s"}` : ""}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </IoRow>
                  )}
                </IoPanel>
                </div>
                {/* The step's browser: live while it runs (web browse
                    streams it), then its recording and screenshots. */}
                <BrowserTheater
                  workspace={workspace}
                  runId={run.id}
                  agent={step.agent}
                  active={stepLive}
                  files={files}
                  hrefOf={(f) => `/api/workspaces/${workspace}/runs/${run.id}/archive?agent=${encodeURIComponent(f.agent)}&path=${encodeURIComponent(f.path)}`}
                />
              </div>
            );
          })()}

          <TraceView
            events={traceEvents(step)}
            running={step.status === "running"}
            tenant={tenant}
            callRun={{ workspace, runId: run.id }}
            boxRef={(el) => {
              if (el) boxRefs.current.set(i, el);
              else boxRefs.current.delete(i);
            }}
            onScroll={(e) => {
              const el = e.currentTarget;
              boxStuck.current.set(i, el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
          />
          </>)}
          </div>
          </div>
        </div>
        );
      })}

      {run.steps.length === 0 && <Badge>no steps</Badge>}
      <div ref={bottomRef} />
    </div>
  );
}

// The two columns on a step card. A panel is a labelled box; a row is one
// fact in it, the name in the margin and the value beside it, so five facts
// read as a list and not as a paragraph.
function IoPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line-faint bg-sunken/60 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

/** "12.3k", "840" — a token count at a glance. */
function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

function IoRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs leading-relaxed">
      <dt className="truncate text-fg-subtle">{k}</dt>
      <dd className="min-w-0 break-words text-fg-secondary">{children}</dd>
    </div>
  );
}


/**
 * A storage/ text file a gate names, fetched and rendered where the decision
 * is made. Markdown renders; anything else is shown as it is. A file the
 * store does not have yet (a run that parked before this platform stored
 * files at a park) says so rather than showing nothing.
 */
function GateDocument({ workspace, tenant, rel, src }: { workspace: string; tenant: string; rel: string; src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let live = true;
    fetch(src, { headers: { "x-foldrun-tenant": tenant } })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "not in the file store yet" : `HTTP ${res.status}`);
        return res.text();
      })
      .then((t) => { if (live) setText(t); })
      .catch((err) => { if (live) setFailed(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [src, tenant, workspace]);
  const isMarkdown = /\.mdx?$/i.test(rel);
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-1 font-mono text-[11px] text-fg-muted hover:text-gray-800">
        {open ? "▾" : "▸"} {rel}
        {failed && <span className="ml-2 text-amber-700">({failed})</span>}
      </button>
      {open && text !== null && (
        <div className="max-h-[32rem] overflow-y-auto rounded border border-line-faint bg-sunken px-3 py-2">
          {isMarkdown
            ? <Markdown text={text} className="text-sm text-gray-800" />
            : <pre className="whitespace-pre-wrap break-words text-xs text-gray-800">{text}</pre>}
        </div>
      )}
    </div>
  );
}
