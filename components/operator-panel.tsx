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
import { Button } from "./kit/button";
import { Input } from "./kit/input";
import { Tag } from "./kit/page";

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
    <div className="mb-4 space-y-3">
      {questions.map((q) => {
        const open = q.answer === undefined && !q.unanswered;
        const given = sent[q.id];
        return (
          <div key={q.id} className={`space-y-2.5 rounded-lg border p-3 text-[13px] ${open && !given ? "border-info-line bg-info-soft" : "border-line bg-surface"}`}>
            <div className="font-medium text-fg">
              <span className="mr-1.5 font-normal text-fg-muted">{step.agent} asks:</span>
              {q.question}
            </div>
            {q.answer !== undefined ? (
              <div className="text-fg-secondary">
                <span className="text-fg-muted">answered{q.by ? ` by ${q.by}` : ""}:</span> {q.answer}
              </div>
            ) : q.unanswered ? (
              <div className="text-fg-muted">No one answered in time; the agent was told to decide or stop.</div>
            ) : given ? (
              <div className="text-fg-secondary">
                <span className="text-fg-muted">sent:</span> {given} <span className="text-fg-subtle">— reaching the agent</span>
              </div>
            ) : running ? (
              <div className="space-y-2">
                {q.options?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <Button key={o} disabled={busy} onClick={() => void answer(q.id, o)}>
                        {o}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Input
                    value={drafts[q.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) void answer(q.id, drafts[q.id] ?? "");
                    }}
                    placeholder={q.options?.length ? "…or answer in your own words" : "Your answer"}
                    aria-label="Your answer"
                    className="flex-1 text-[13px]"
                  />
                  <Button size="md" variant="primary" disabled={busy || !(drafts[q.id] ?? "").trim()} onClick={() => void answer(q.id, drafts[q.id] ?? "")}>
                    Answer
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-fg-muted">The step ended before it was answered.</div>
            )}
          </div>
        );
      })}

      {messages.length > 0 && (
        <ul className="space-y-1">
          {messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-secondary">
              {m.to ? (
                <>
                  <Tag className="h-5">{step.agent} → {m.to.join(", ") || "nobody"}</Tag>
                  {m.text}
                </>
              ) : m.from ? (
                <>
                  <Tag className="h-5">{m.from} → {step.agent}</Tag>
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
        <div key={`p-${i}`} className="text-[13px] text-fg-muted">
          <span className="text-fg-subtle">you said:</span> {t} <span className="text-fg-subtle">— reaches it after its next tool call</span>
        </div>
      ))}

      {running && (
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void send();
            }}
            placeholder={`Message ${step.agent} while it works`}
            aria-label="Message the agent"
            maxLength={4000}
            className="flex-1 text-[13px]"
          />
          <Button size="md" disabled={busy || !message.trim()} onClick={() => void send()}>
            Send
          </Button>
        </div>
      )}
      {error && <div className="text-[13px] text-danger">{error}</div>}
    </div>
  );
}
