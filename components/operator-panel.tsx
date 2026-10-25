"use client";

// A person in the loop, on the run page: the questions a step asked while it
// ran (tools: [ask]) — answered here with a click or a sentence — and, while
// the step runs, a box to say something to it. The agent's sandbox is live
// and waiting on a question; an answer reaches it within a second or two.
//
// Colleagues too (tools: [peers], 20 Oct 2026): a message a sibling step of
// the same parallel group sent this one shows with the sibling's name, and
// one this step sent shows who it went to — the same list, so the whole
// conversation a step had while it ran reads top to bottom.

import { useState } from "react";
import type { StepRecord } from "@/lib/store";
import { buttonClass } from "./ui";

export function OperatorPanel({
  workspace,
  tenant,
  runId,
  step,
  stepIndex,
}: {
  workspace: string;
  tenant: string;
  runId: string;
  step: StepRecord;
  /** The step's index in run.steps — which inbox a message goes to, so a
   *  parallel sibling never reads it. */
  stepIndex?: number;
}) {
  const running = step.status === "running";
  const questions = step.questions ?? [];
  const messages = step.messages ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}`;
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };

  if (!questions.length && !messages.length && !running) return null;

  const answer = async (id: string, text: string) => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/answer`, { method: "POST", headers, body: JSON.stringify({ question: id, answer: text.trim() }) });
      const body = await res.json().catch(() => ({}));
      // 409 with an answer: someone answered first, and theirs stands. 409
      // without one: the agent stopped waiting — say so, send nothing.
      if (res.ok || (res.status === 409 && typeof body.answer === "string")) setSent((s) => ({ ...s, [id]: body.answer ?? text.trim() }));
      else if (res.status === 403) setError("You cannot answer here — answering needs permission to start runs.");
      else setError(body.error ?? `could not answer (${res.status})`);
    } catch (err) {
      setError(`could not answer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = message.trim();
    if (busy || !text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, ...(typeof stepIndex === "number" ? { step: stepIndex } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPending((p) => [...p, text]);
        setMessage("");
      } else if (res.status === 403) setError("You cannot write to this run — it needs permission to start runs.");
      else setError(body.error ?? `could not send (${res.status})`);
    } catch (err) {
      setError(`could not send: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // A sent message stops being "on its way" once the trace says delivered.
  const onTheWay = pending.filter((t) => !messages.some((m) => m.text === t && !m.from && !m.to));

  return (
    <div className="mb-3 space-y-2">
      {questions.map((q) => {
        const open = q.answer === undefined && !q.unanswered;
        const given = sent[q.id];
        return (
          <div key={q.id} className={`space-y-2 rounded-lg border px-3 py-2 ${open && !given ? "border-violet-300 bg-violet-50" : "border-line bg-surface"}`}>
            <div className="text-xs font-medium text-fg">
              <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                {step.agent} asks
              </span>
              {q.question}
            </div>
            {q.answer !== undefined ? (
              <div className="text-xs text-fg-secondary">
                <span className="text-fg-muted">answered{q.by ? ` by ${q.by}` : ""}:</span> {q.answer}
              </div>
            ) : q.unanswered ? (
              <div className="text-xs text-fg-muted">No one answered in time; the agent was told to decide or stop.</div>
            ) : given ? (
              <div className="text-xs text-fg-secondary">
                <span className="text-fg-muted">sent:</span> {given} <span className="text-fg-subtle">— reaching the agent</span>
              </div>
            ) : running ? (
              <div className="space-y-2">
                {q.options?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <button key={o} disabled={busy} onClick={() => void answer(q.id, o)} className={buttonClass("secondary", "!px-2 !py-1 !text-xs")}>
                        {o}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <input
                    value={drafts[q.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) void answer(q.id, drafts[q.id] ?? "");
                    }}
                    placeholder={q.options?.length ? "…or answer in your own words" : "Your answer"}
                    aria-label="Your answer"
                    className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-fg focus:border-gray-400 focus:outline-none"
                  />
                  <button disabled={busy || !(drafts[q.id] ?? "").trim()} onClick={() => void answer(q.id, drafts[q.id] ?? "")} className={buttonClass("primary", "!px-3 !py-1 !text-xs")}>
                    Answer
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-fg-muted">The step ended before it was answered.</div>
            )}
          </div>
        );
      })}

      {messages.length > 0 && (
        <ul className="space-y-1">
          {messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className="text-xs text-fg-tertiary">
              {m.to ? (
                <>
                  <span className="mr-1 rounded bg-sky-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-800">{step.agent} → {m.to.join(", ") || "nobody"}</span>
                  {m.text}
                </>
              ) : m.from ? (
                <>
                  <span className="mr-1 rounded bg-sky-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-800">{m.from} → {step.agent}</span>
                  {m.text} <span className="text-fg-subtle">— delivered</span>
                </>
              ) : (
                <>
                  <span className="text-fg-subtle">you said{m.by ? ` (${m.by})` : ""}:</span> {m.text}{" "}
                  <span className="text-fg-subtle">— delivered</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {onTheWay.map((t, i) => (
        <div key={`p-${i}`} className="text-xs text-fg-muted">
          <span className="text-fg-subtle">you said:</span> {t} <span className="text-fg-subtle">— reaches it after its next tool call</span>
        </div>
      ))}

      {running && (
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void send();
            }}
            placeholder={`Message ${step.agent} while it works`}
            aria-label="Message the agent"
            maxLength={4000}
            className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-fg focus:border-gray-400 focus:outline-none"
          />
          <button disabled={busy || !message.trim()} onClick={() => void send()} className={buttonClass("secondary", "!px-3 !py-1 !text-xs")}>
            Send
          </button>
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
