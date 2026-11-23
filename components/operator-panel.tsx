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

import { $t } from "@/i18n";
import { useState } from "react";
import type { StepRecord } from "@/lib/store";
import { Button } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Tag, Callout } from "@foldrun/ui/react/page";

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
  const base = `/v1/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}`;
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
      else if (res.status === 403) setError($t("components.operator-panel.youCannotAnswerHereAnsweringNeeds"));
      else setError(body.error ?? $t("components.operator-panel.couldNotAnswer", { status: String(res.status) }));
    } catch (err) {
      setError($t("components.operator-panel.couldNotAnswer2", { v0: String(err instanceof Error ? err.message : String(err)) }));
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
      } else if (res.status === 403) setError($t("components.operator-panel.youCannotWriteToThisRun"));
      else setError(body.error ?? $t("components.operator-panel.couldNotSend", { status: String(res.status) }));
    } catch (err) {
      setError($t("components.operator-panel.couldNotSend2", { v0: String(err instanceof Error ? err.message : String(err)) }));
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
          <Callout key={q.id} tone={open && !given ? "info" : "neutral"} className={`p-3 text-[13px] text-fg ${open && !given ? "" : "bg-surface"}`} bodyClassName="space-y-2.5">
            <div className="font-medium text-fg">
              <span className="mr-1.5 font-normal text-fg-muted">{$t("components.operator-panel.asks", { agent: step.agent })}</span>
              {q.question}
            </div>
            {q.answer !== undefined ? (
              <div className="text-fg-secondary">
                <span className="text-fg-muted">{q.by ? $t("components.operator-panel.answeredBy", { by: q.by }) : $t("components.operator-panel.answered")}:</span> {q.answer}
              </div>
            ) : q.unanswered ? (
              <div className="text-fg-muted">{$t("components.operator-panel.noOneAnsweredInTimeThe")}</div>
            ) : given ? (
              <div className="text-fg-secondary">
                <span className="text-fg-muted">{$t("components.operator-panel.sent")}</span> {given} <span className="text-fg-subtle">{$t("components.operator-panel.reachingTheAgent")}</span>
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
                    placeholder={q.options?.length ? $t("components.operator-panel.orAnswerInYourOwnWords") : $t("components.operator-panel.yourAnswer")}
                    aria-label={$t("components.operator-panel.yourAnswer")}
                    className="flex-1 text-[13px]"
                  />
                  <Button size="md" variant="primary" disabled={busy || !(drafts[q.id] ?? "").trim()} onClick={() => void answer(q.id, drafts[q.id] ?? "")}>
                    {$t("components.operator-panel.answer")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-fg-muted">{$t("components.operator-panel.theStepEndedBeforeItWas")}</div>
            )}
          </Callout>
        );
      })}

      {messages.length > 0 && (
        <ul className="space-y-1">
          {messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-secondary">
              {m.to ? (
                <>
                  <Tag className="h-5">{step.agent} → {m.to.join(", ") || $t("components.operator-panel.nobody")}</Tag>
                  {m.text}
                </>
              ) : m.from ? (
                <>
                  <Tag className="h-5">{m.from} → {step.agent}</Tag>
                  {m.text} <span className="text-fg-subtle">{$t("components.operator-panel.delivered")}</span>
                </>
              ) : (
                <>
                  <span className="text-fg-subtle">{$t("components.operator-panel.youSaid")}{m.by ? ` (${m.by})` : ""}:</span> {m.text}{" "}
                  <span className="text-fg-subtle">{$t("components.operator-panel.delivered")}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {onTheWay.map((t, i) => (
        <div key={`p-${i}`} className="text-[13px] text-fg-muted">
          <span className="text-fg-subtle">{$t("components.operator-panel.youSaid2")}</span> {t} <span className="text-fg-subtle">{$t("components.operator-panel.reachesItAfterItsNextTool")}</span>
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
            placeholder={$t("components.operator-panel.messageWhileItWorks", { agent: String(step.agent) })}
            aria-label={$t("components.operator-panel.messageTheAgent")}
            maxLength={4000}
            className="flex-1 text-[13px]"
          />
          <Button size="md" disabled={busy || !message.trim()} onClick={() => void send()}>
            {$t("components.operator-panel.send")}
          </Button>
        </div>
      )}
      {error && <div className="text-[13px] text-danger">{error}</div>}
    </div>
  );
}
