"use client";

// The one banner that follows you around the dashboard.
//
// A run parked at an approval gate is waiting on a person, and every minute it
// waits is a flow stopped after money was already spent on the steps before
// the gate. The email notification exists, but an email can be missed; the
// per-workspace runs page says so, but only to someone already looking at it.
// So this renders above every dashboard page, polls quietly, and disappears
// entirely when there is nothing to approve — a banner that is usually absent
// is one that still means something when it shows.
//
// The unit is the GATE — a step waiting on a person — grouped by run. A run
// with two `!` steps in one group shows both, each with what it is asking,
// each decidable here without opening the run. A decision removes its gate
// in the same frame; the refetch confirms it against the step's own status,
// so the gate cannot come back while the worker is still picking the run up.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CHIP_BUTTON_CLASS } from "@/components/ui";

interface Question {
  id: string;
  workspace: string;
  runId: string;
  flow: string;
  agent: string;
  question: string;
  options?: string[];
  askedAt: string;
}

interface Gate {
  workspace: string;
  runId: string;
  flow: string;
  step: number;
  agent: string;
  question: string;
  asked: boolean;
  startedAt: string;
  waitingSince: string;
}

// Every 20 s while the tab is looked at; every 60 s while it is not. A
// dashboard left open in a background tab all day was the single largest
// caller of /api/approvals, and it was asking on behalf of nobody.
const POLL_MS = 20_000;
const HIDDEN_POLL_MS = 60_000;

/** Fired by whoever decides a gate (the run page's approve, reject and stop),
 *  with `{ runId, step? }` in `detail`. Without a step, every gate of that run
 *  is dropped — a stop ends them all. */
export const DECIDED_EVENT = "foldrun:approval-decided";

export function announceDecision(runId: string, step?: number) {
  window.dispatchEvent(new CustomEvent(DECIDED_EVENT, { detail: { runId, step } }));
}

const key = (g: { runId: string; step: number }) => `${g.runId}#${g.step}`;

function waitedFor(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

export function PendingApprovals() {
  const params = useSearchParams();
  const account = params.get("tenant") ?? "default";
  const [gates, setGates] = useState<Gate[]>([]);
  // Questions agents asked mid-step (tools: [ask]): their sandboxes are live
  // and waiting, which costs more by the minute than a parked gate.
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // Why an answer did not go through, per question — a refusal must be seen,
  // not swallowed (a viewer's click used to do nothing at all).
  const [answerError, setAnswerError] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/approvals", { headers: { "x-foldrun-tenant": account } })
        .then((r) => (r.ok ? r.json() : { approvals: [] }))
        .then((d) => {
          if (!live) return;
          setGates(d.approvals ?? []);
          setQuestions(d.questions ?? []);
        })
        .catch(() => {});
    load();
    // The interval follows the tab: slow while hidden, and a fetch the
    // moment it is shown again, so a person coming back is not looking at
    // a banner up to a minute stale.
    let timer = setInterval(load, document.visibilityState === "hidden" ? HIDDEN_POLL_MS : POLL_MS);
    const onVisibility = () => {
      clearInterval(timer);
      const hidden = document.visibilityState === "hidden";
      if (!hidden) load();
      timer = setInterval(load, hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onDecided = (e: Event) => {
      const { runId, step } = (e as CustomEvent<{ runId?: string; step?: number }>).detail ?? {};
      if (runId) setGates((cur) => cur.filter((g) => g.runId !== runId || (step !== undefined && g.step !== step)));
      load();
    };
    window.addEventListener(DECIDED_EVENT, onDecided);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(DECIDED_EVENT, onDecided);
    };
  }, [account]);

  // Gates of one run sit together, runs in the order their first gate
  // started waiting — the oldest ask is the one costing the most.
  const runs = useMemo(() => {
    const byRun = new Map<string, Gate[]>();
    for (const g of gates) byRun.set(g.runId, [...(byRun.get(g.runId) ?? []), g]);
    return [...byRun.values()];
  }, [gates]);

  const decide = async (g: Gate, decision: "approve" | "reject") => {
    const k = key(g);
    setBusy((b) => new Set(b).add(k));
    try {
      const res = await fetch(`/api/workspaces/${g.workspace}/runs/${g.runId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": account },
        body: JSON.stringify({ decision, step: g.step }),
      });
      // 409 is "already decided" — by the run page, an email link, someone
      // else. Either way the gate is gone, and that is what the banner shows.
      if (res.ok || res.status === 409) announceDecision(g.runId, g.step);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(k);
        return n;
      });
    }
  };

  const answer = async (q: Question, text: string) => {
    const k = `q:${q.id}`;
    if (busy.has(k)) return;
    setBusy((b) => new Set(b).add(k));
    const fail = (msg: string) => setAnswerError((e) => ({ ...e, [q.id]: msg }));
    try {
      const res = await fetch(`/api/workspaces/${q.workspace}/runs/${q.runId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": account },
        body: JSON.stringify({ question: q.id, answer: text }),
      });
      // 409: answered by someone else, or the agent stopped waiting —
      // either way there is nothing left to answer here.
      if (res.ok || res.status === 409) {
        setQuestions((cur) => cur.filter((x) => x.id !== q.id));
        setAnswerError((e) => {
          const n = { ...e };
          delete n[q.id];
          return n;
        });
      } else if (res.status === 403) fail("you cannot answer — it needs permission to start runs");
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        fail(body.error ?? `could not answer (${res.status})`);
      }
    } catch (err) {
      fail(`could not answer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(k);
        return n;
      });
    }
  };

  if (gates.length === 0 && questions.length === 0) return null;
  const tenantParam = account !== "default" ? `&tenant=${account}` : "";
  const shown = runs.slice(0, 3);
  const hiddenGates = gates.length - shown.reduce((n, r) => n + r.length, 0);

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2.5">
      <div className="mx-auto max-w-5xl text-sm text-amber-900">
        {questions.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-2 font-medium">
              <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-500" aria-hidden />
              {questions.length === 1 ? "An agent is asking you something" : `${questions.length} agents are asking you something`}
            </div>
            <ul className="mt-1.5 space-y-1">
              {questions.slice(0, 3).map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/dashboard/${q.workspace}/runs/${q.runId}${tenantParam.replace("&", "?")}`} className="w-44 shrink-0 truncate font-medium hover:underline">
                    {q.workspace} · {q.flow}
                  </Link>
                  <span className="rounded bg-surface/70 px-1.5 font-mono text-xs text-amber-800">{q.agent}</span>
                  <span className="min-w-0 flex-1 truncate" title={q.question}>{q.question}</span>
                  <span className="text-xs text-amber-700">{waitedFor(q.askedAt)}</span>
                  {(q.options ?? []).slice(0, 4).map((o) => (
                    <button
                      key={o}
                      type="button"
                      disabled={busy.has(`q:${q.id}`)}
                      onClick={() => answer(q, o)}
                      className={`${CHIP_BUTTON_CLASS} border-violet-300 text-violet-800 hover:bg-violet-50`}
                    >
                      {o}
                    </button>
                  ))}
                  <Link href={`/dashboard/${q.workspace}/runs/${q.runId}${tenantParam.replace("&", "?")}`} className="text-xs text-amber-800 hover:underline">
                    answer →
                  </Link>
                  {answerError[q.id] && (
                    <span role="alert" className="basis-full text-xs text-red-700">
                      {answerError[q.id]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {gates.length > 0 && (
        <div className="flex items-center gap-2 font-medium">
          <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden />
          {gates.length === 1
            ? "A run is waiting for your approval"
            : runs.length === 1
              ? `${gates.length} gates in one run are waiting for your approval`
              : `${gates.length} gates in ${runs.length} runs are waiting for your approval`}
        </div>
        )}
        <ul className="mt-1.5 space-y-1">
          {shown.map((group) =>
            group.map((g, i) => (
              <li key={key(g)} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* The run is named once; its other gates hang under it. */}
                <Link
                  href={`/dashboard/${g.workspace}/runs/${g.runId}${tenantParam.replace("&", "?")}`}
                  className={`w-44 shrink-0 truncate font-medium hover:underline ${i > 0 ? "invisible" : ""}`}
                  aria-hidden={i > 0}
                >
                  {g.workspace} · {g.flow}
                </Link>
                <span className="rounded bg-surface/70 px-1.5 font-mono text-xs text-amber-800">{g.agent}</span>
                <span className="min-w-0 flex-1 truncate" title={g.question}>
                  {g.asked ? g.question : `approve “${g.question}”?`}
                </span>
                <span className="text-xs text-amber-700">{waitedFor(g.waitingSince)}</span>
                <button
                  type="button"
                  disabled={busy.has(key(g))}
                  onClick={() => decide(g, "approve")}
                  className={`${CHIP_BUTTON_CLASS} border-emerald-300 text-emerald-800 hover:bg-emerald-50`}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy.has(key(g))}
                  onClick={() => decide(g, "reject")}
                  className={`${CHIP_BUTTON_CLASS} hover:border-red-200 hover:text-red-700`}
                >
                  Reject
                </button>
                <Link
                  href={`/dashboard/${g.workspace}/runs/${g.runId}${tenantParam.replace("&", "?")}`}
                  className="text-xs text-amber-800 hover:underline"
                >
                  review →
                </Link>
              </li>
            )),
          )}
        </ul>
        {hiddenGates > 0 && (
          <Link href={`/dashboard/runs?status=awaiting-approval${tenantParam}`} className="mt-1 inline-block text-xs text-amber-700 hover:underline">
            and {hiddenGates} more — see all
          </Link>
        )}
      </div>
    </div>
  );
}
