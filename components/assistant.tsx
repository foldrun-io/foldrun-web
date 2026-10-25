"use client";

// The assistant: a panel on every workspace page for asking how foldrun
// works and having agents, flows, tools and skills written.
//
// It answers from foldrun's docs and this workspace's files only (POST
// …/assistant, server/assistant.ts), streaming what it reads and what it
// says. Files it writes are proposals: each is shown as a diff with what the
// check finds, and is written through the ordinary source PUT only when a
// person presses Save — a revision like any edit, restorable from History.
// The conversation lives in this tab (sessionStorage) and is sent with each
// message; the server keeps none of it.
//
// Opened by the button at the bottom right, or by any control that
// dispatches `foldrun:assistant` with an optional `{ prompt }` to start from.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge, buttonClass, inputClass } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { useCan, needs } from "@/components/role";
import { foldDiff, lineDiff } from "@/components/flow-history-model";
import { DiffView } from "@/components/flow-history";
import { postCreate } from "@/components/create";
import {
  chatFromStored,
  continueKey,
  groupConversations,
  historyOf,
  issuesFor,
  meterLine,
  WORKSPACE_NAME,
  linkCitations,
  pageContext,
  parseSse,
  readSavedChat,
  saveMessage,
  storageKey,
  type AssistantFile,
  type AssistantIssue,
  type AssistantReply,
  type ChatMessage,
  type ConversationSummary,
  type ProposedWorkspace,
} from "@/components/assistant-model";

const MAX = 8000;

export const ASSISTANT_EVENT = "foldrun:assistant";

/** Open the assistant from anywhere, optionally with a message to start from
 *  and the workspace to work in (an issue's Doctor on the account home names
 *  the desk its run is in; without one the page decides, as before). */
export function openAssistant(prompt?: string, workspace?: string) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: { prompt, workspace } }));
}

const LAST_WORKSPACE = (tenant: string) => `foldrun.assistant.${tenant}.workspace`;

/** The workspace a dashboard path is inside, if its first segment is one. */
function workspaceOfPath(pathname: string, workspaces: string[]): string | null {
  let seg = "";
  try {
    seg = decodeURIComponent(pathname.split("/")[2] ?? "");
  } catch {
    return null; // a malformed escape names no workspace
  }
  return seg && workspaces.includes(seg) ? seg : null;
}

/**
 * The button and the panel, on every dashboard page. Inside a workspace the
 * assistant works in that one; anywhere else (the account home, Billing,
 * Docs) it works in the one picked in its header, remembered per browser.
 */
export function AssistantDock({ tenant }: { tenant: string }) {
  const mayWrite = useCan("workspace:write");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // A pick holds on the page it was made on; moving into a workspace means
  // working in that one.
  const [picked, setPicked] = useState<{ ws: string; at: string } | null>(null);

  const isOpen = useRef(false);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  // The listener below is set once; these say where it is and what it is
  // working in at the moment an event arrives.
  const at = useRef(pathname);
  const current = useRef<string | null>(null);
  useEffect(() => {
    at.current = pathname;
  }, [pathname]);

  // Whether the open panel is waiting on a reply, and a move to another
  // workspace asked for meanwhile: switching would unmount the panel and
  // lose a reply already being paid for, so the move waits for it (Codex
  // review), as the panel's own workspace picker does by being disabled.
  const busy = useRef(false);
  const [pending, setPending] = useState<{ ws: string; prompt: string | null } | null>(null);

  useEffect(() => {
    // An open panel takes the prompt itself (AssistantPanel's own listener),
    // unless the event names another workspace: then the panel for that one
    // mounts, and the prompt goes to it as its seed.
    const onOpen = (e: Event) => {
      const { prompt, workspace: ws } = (e as CustomEvent<{ prompt?: string; workspace?: string }>).detail ?? {};
      const moving = Boolean(ws && ws !== current.current);
      if (isOpen.current && moving && busy.current) {
        setPending({ ws: ws!, prompt: prompt ?? null });
        return;
      }
      // Taken now, so an older held move must not override it (Codex review).
      setPending(null);
      if (ws) setPicked({ ws, at: at.current });
      if (isOpen.current && !moving) return;
      setSeed(prompt ?? null);
      setOpen(true);
    };
    window.addEventListener(ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_EVENT, onOpen);
  }, []);

  /** The panel's reply finished: make the move it was holding back. */
  const onBusy = (b: boolean) => {
    busy.current = b;
    if (b || !pending) return;
    setPicked({ ws: pending.ws, at: at.current });
    setSeed(pending.prompt);
    setPending(null);
  };

  // The workspaces this person can reach, once, when the panel first opens.
  useEffect(() => {
    if (!open || workspaces !== null) return;
    let live = true;
    fetch("/api/workspaces", { headers: { "x-foldrun-tenant": tenant } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { workspaces?: { name: string }[]; error?: string };
        if (!live) return;
        if (!res.ok) setListError(body.error ?? `could not list workspaces (${res.status})`);
        else setWorkspaces((body.workspaces ?? []).map((w) => w.name));
      })
      .catch(() => live && setListError("could not list workspaces"));
    return () => {
      live = false;
    };
  }, [open, workspaces, tenant]);

  let workspace: string | null = null;
  if (workspaces) {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WORKSPACE(tenant));
    } catch {
      // no storage: the first workspace
    }
    workspace =
      (picked && picked.at === pathname && workspaces.includes(picked.ws) ? picked.ws : null) ??
      workspaceOfPath(pathname, workspaces) ??
      (last && workspaces.includes(last) ? last : null) ??
      workspaces[0] ??
      null;
  }
  useEffect(() => {
    current.current = workspace;
  }, [workspace]);

  const router = useRouter();
  /** A workspace the panel just created: list it, work in it, go there. */
  const created = (ws: string) => {
    setWorkspaces((list) => [...new Set([...(list ?? []), ws])].sort());
    pick(ws);
    router.push(`/dashboard/${encodeURIComponent(ws)}`);
  };

  const pick = (ws: string) => {
    setPicked({ ws, at: pathname });
    try {
      localStorage.setItem(LAST_WORKSPACE(tenant), ws);
    } catch {
      // remembered for this page only
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          disabled={!mayWrite}
          title={mayWrite ? "Ask how foldrun works, or have agents, flows, tools and skills written" : needs("workspace:write")}
          onClick={() => setOpen(true)}
          className={buttonClass("primary", "fixed bottom-6 right-6 z-30 px-4 py-2 text-sm shadow-lg disabled:opacity-60")}
        >
          Ask AI
        </button>
      )}
      {open &&
        (workspace && workspaces ? (
          <AssistantPanel
            key={workspace}
            workspace={workspace}
            workspaces={workspaces}
            onPick={pick}
            onCreated={created}
            tenant={tenant}
            seed={seed}
            onSeedUsed={() => setSeed(null)}
            onBusy={onBusy}
            queued={pending ? `Doctor in ${pending.ws} opens when this reply is done.` : null}
            onClose={() => {
              // Closing drops a held move: it was asked of this panel.
              setPending(null);
              setOpen(false);
            }}
          />
        ) : (
          <aside role="dialog" aria-label="Assistant" className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-xl sm:w-[440px]">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">Assistant</h2>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass("minimal", "ml-auto px-2 py-1 text-xs")}>
                Close
              </button>
            </header>
            {workspaces && !listError ? (
              <div className="space-y-2 px-4 py-3 text-sm text-fg-secondary">
                <p>The assistant works inside a workspace, and this account has none yet. Name the first one:</p>
                <CreateWorkspace tenant={tenant} onCreated={created} />
              </div>
            ) : (
              <p className={`px-4 py-3 text-sm ${listError ? "text-danger" : "text-fg-muted"}`}>{listError ?? "Loading…"}</p>
            )}
          </aside>
        ))}
    </>
  );
}

function AssistantPanel({
  workspace,
  workspaces,
  onPick,
  onCreated,
  tenant,
  seed,
  onSeedUsed,
  onBusy,
  queued,
  onClose,
}: {
  workspace: string;
  workspaces: string[];
  onPick: (workspace: string) => void;
  onCreated: (workspace: string) => void;
  tenant: string;
  seed: string | null;
  onSeedUsed: () => void;
  /** Told when a reply starts and ends, so a move to another workspace
   *  can wait for it. */
  onBusy?: (busy: boolean) => void;
  /** A move waiting for this reply, said under the input. */
  queued?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const key = storageKey(tenant, workspace);
  // The conversation, back from this tab. The panel only ever renders in the
  // browser (it mounts on a click), so storage is there to read.
  const [initial] = useState(() => {
    try {
      return readSavedChat(sessionStorage.getItem(key));
    } catch {
      return readSavedChat(null);
    }
  });
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [files, setFiles] = useState<AssistantFile[]>(initial.files);
  const [issues, setIssues] = useState<AssistantIssue[]>(initial.issues);
  const [conversation, setConversation] = useState<string | null>(initial.conversation);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState(seed ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  // The dock holds a move to another workspace until this is false.
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // State is a snapshot per render: two Enters in one tick would both see
  // busy === false. The ref is read and set synchronously.
  const inFlight = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant, "content-type": "application/json" }), [tenant]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ messages: messages.slice(-40), files, issues, conversation }));
    } catch {
      // a full or refused storage only costs the conversation a reload
    }
  }, [key, messages, files, issues, conversation]);

  // A control asking for the assistant while it is open starts the message.
  useEffect(() => {
    if (seed) onSeedUsed();
    box.current?.focus();
    const onAsk = (e: Event) => {
      const { prompt, workspace: ws } = (e as CustomEvent<{ prompt?: string; workspace?: string }>).detail ?? {};
      // Meant for another workspace: the dock moves there (or holds the
      // move until this reply is done); this panel's input is left alone.
      if (ws && ws !== workspace) return;
      if (prompt) setInput(prompt);
      box.current?.focus();
    };
    window.addEventListener(ASSISTANT_EVENT, onAsk);
    return () => window.removeEventListener(ASSISTANT_EVENT, onAsk);
    // Once, on opening: the seed was read into the first state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, status, files.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    if (override === undefined) setInput("");
    setBusy(true);
    setStatus("Thinking");
    setStreaming("");
    setSaveError(null);
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    const fail = (error: string) => {
      finished = true;
      setMessages((m) => [...m, { role: "assistant", content: error, error: true }]);
    };
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/assistant`, {
        method: "POST",
        headers: { ...headers, accept: "text/event-stream" },
        body: JSON.stringify({
          messages: historyOf(next),
          ...(conversation ? { conversation } : {}),
          files: files.map((f) => ({ path: f.path, content: f.content })),
          page: pageContext(pathname, window.location.search, workspace),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        fail(body.error ?? `the assistant refused (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSse(buffer);
        buffer = rest;
        handle(events);
      }
      // What the decoder still holds, and a last frame without its blank line.
      buffer += decoder.decode();
      if (buffer.trim()) handle(parseSse(`${buffer}\n\n`).events);
      if (!finished) fail("the reply stopped before it finished — ask again");
    } catch (err) {
      if (!finished) fail(controller.signal.aborted ? "stopped — the reply still finishes on the server and is charged; ask again to see one" : err instanceof Error ? err.message : "the assistant could not be reached");
    } finally {
      inFlight.current = false;
      abort.current = null;
      setBusy(false);
      setStatus(null);
      setStreaming("");
    }

    function handle(events: ReturnType<typeof parseSse>["events"]) {
      for (const e of events) {
        if (e.event === "status") setStatus(e.text);
        else if (e.event === "text") setStreaming((s) => s + e.text);
        else if (e.event === "error") fail(e.error);
        else if (e.event === "done") {
          finished = true;
          const r: AssistantReply = e.reply;
          setMessages((m) => [...m, { role: "assistant", content: r.reply || "(no answer)", sources: r.sources, workspace: r.workspace ?? null, meter: meterLine(r) }]);
          setFiles(r.files);
          setIssues(r.issues);
          if (r.conversation) setConversation(r.conversation);
        }
      }
    }
  }, [conversation, files, headers, input, messages, pathname, workspace]);

  // A conversation that just created this workspace carries on here, once.
  useEffect(() => {
    let next: string | null = null;
    try {
      if (sessionStorage.getItem(continueKey(tenant)) === workspace) {
        sessionStorage.removeItem(continueKey(tenant));
        next = `The workspace "${workspace}" now exists and you are working in it. Carry on with what I asked for: write its agents, flows, tools and skills.`;
      }
    } catch {
      // no storage: the person asks again
    }
    // After this render: the send sets state, which an effect body must not.
    if (next) queueMicrotask(() => void send(next));
    // Once, on opening in a new workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Create the workspace a reply proposed, then carry the conversation into it. */
  const createProposed = async (ws: ProposedWorkspace) => {
    try {
      sessionStorage.setItem(
        storageKey(tenant, ws.name),
        JSON.stringify({ messages: [...messages.slice(-38), { role: "assistant", content: `Created the workspace \`${ws.name}\`.` }], files: [], issues: [] }),
      );
      sessionStorage.setItem(continueKey(tenant), ws.name);
    } catch {
      // the new workspace opens with a fresh conversation
    }
    onCreated(ws.name);
  };

  const save = async (which: AssistantFile[]) => {
    if (!which.length) return;
    setSaving(which.length === 1 ? which[0].path : "all");
    setSaveError(null);
    const note = saveMessage(messages);
    const done: string[] = [];
    try {
      for (const f of which) {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/source`, {
          method: "PUT",
          headers,
          // A new file expects none there (ifMatch: null): one created since
          // the proposal is refused, not overwritten.
          body: JSON.stringify({ path: f.path, content: f.content, message: note, ifMatch: f.sha256 ?? null }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `${f.path}: ${res.status === 409 ? `${f.before === null ? "someone created it" : "it changed"} since this was proposed — ask the assistant to propose it again` : (body.error ?? `refused (${res.status})`)}`,
          );
        }
        done.push(f.path);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "save failed");
    } finally {
      if (done.length) {
        setFiles((fs) => fs.filter((f) => !done.includes(f.path)));
        setIssues((is) => is.filter((i) => !done.some((p) => i.where === p || i.where.startsWith(`${p}:`))));
        setMessages((m) => [...m, { role: "assistant", content: `Saved ${done.map((p) => `\`${p}\``).join(", ")}. Each is a revision in History.` }]);
        router.refresh();
      }
      setSaving(null);
    }
  };

  const discard = (path: string) => {
    setFiles((fs) => fs.filter((f) => f.path !== path));
    setIssues((is) => is.filter((i) => !(i.where === path || i.where.startsWith(`${path}:`))));
  };

  /** Open a stored conversation: here when it is this workspace's, else in
   *  its own workspace (the panel moves there and reads it from the tab). */
  const openStored = async (id: string) => {
    setShowHistory(false);
    try {
      const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { headers });
      const c = (await res.json().catch(() => ({}))) as {
        id?: string;
        workspace?: string;
        messages?: { role: "user" | "assistant"; content: string; meta?: Record<string, unknown> }[];
        files?: AssistantFile[];
        error?: string;
      };
      if (!res.ok || !c.id || !c.workspace) {
        setSaveError(c.error ?? `could not open it (${res.status})`);
        return;
      }
      const chat = { messages: (c.messages ?? []).map(chatFromStored), files: c.files ?? [], issues: [], conversation: c.id };
      if (c.workspace !== workspace) {
        try {
          sessionStorage.setItem(storageKey(tenant, c.workspace), JSON.stringify(chat));
        } catch {
          // opens empty there; the history still has it
        }
        onPick(c.workspace);
        return;
      }
      setMessages(chat.messages);
      setFiles(chat.files);
      setIssues([]);
      setConversation(c.id);
    } catch {
      setSaveError("could not reach the platform");
    }
  };

  const reset = () => {
    abort.current?.abort();
    setMessages([]);
    setFiles([]);
    setIssues([]);
    setSaveError(null);
    setConversation(null);
  };

  const errors = issues.filter((i) => i.level === "error").length;

  return (
    <aside
      role="dialog"
      aria-label="Assistant"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-xl sm:w-[440px]"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            Assistant
            <span className="font-normal text-fg-muted">in</span>
            {workspaces.length > 1 ? (
              <select
                aria-label="Assistant's workspace"
                value={workspace}
                disabled={busy}
                onChange={(e) => onPick(e.target.value)}
                className="max-w-[12rem] truncate rounded border border-line bg-surface px-1 py-0.5 text-xs font-medium text-fg"
              >
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-xs">{workspace}</span>
            )}
          </h2>
          <p className="text-[11px] text-fg-muted">Answers from the foldrun docs. Nothing is saved until you press Save.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          disabled={busy}
          aria-pressed={showHistory}
          className={buttonClass("minimal", "ml-auto px-2 py-1 text-xs")}
        >
          History
        </button>
        <button type="button" onClick={reset} disabled={busy || (!messages.length && !files.length)} className={buttonClass("minimal", "px-2 py-1 text-xs")}>
          New chat
        </button>
        <button type="button" onClick={onClose} className={buttonClass("minimal", "px-2 py-1 text-xs")}>
          Close
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {showHistory && <History headers={headers} current={conversation} onOpen={(id) => void openStored(id)} />}
        {!showHistory && !messages.length && !busy && <Welcome onPick={(t) => setInput(t)} />}
        {!showHistory && messages.map((m, i) => (
          <Message key={i} message={m} tenant={tenant} existing={workspaces} busy={busy} onCreate={(ws) => void createProposed(ws)} />
        ))}
        {busy && (
          <div className="space-y-1">
            {streaming && <Markdown text={linkCitations(streaming)} className="text-sm text-fg" />}
            {status && <p className="animate-pulse text-[11px] text-fg-muted">{status}…</p>}
          </div>
        )}

        {!showHistory && files.length > 0 && (
          <section aria-label="Proposed files" className="space-y-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-fg">
                {files.length} proposed file{files.length === 1 ? "" : "s"}
              </span>
              {errors === 0 ? <Badge variant="success">passes the check</Badge> : <Badge variant="error">{errors} error{errors === 1 ? "" : "s"}</Badge>}
              {files.length > 1 && (
                <button
                  type="button"
                  disabled={busy || saving !== null}
                  onClick={() => void save(files)}
                  className={buttonClass("primary", "ml-auto px-3 py-1 text-xs")}
                >
                  {saving === "all" ? "Saving…" : `Save all ${files.length}`}
                </button>
              )}
            </div>
            {saveError && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                {saveError}
              </p>
            )}
            {files.map((f) => (
              <ProposedFile
                key={f.path}
                file={f}
                issues={issuesFor(issues, f.path)}
                busy={busy || saving !== null}
                saving={saving === f.path}
                onSave={() => void save([f])}
                onDiscard={() => discard(f.path)}
              />
            ))}
          </section>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {queued && <p className="mb-1.5 text-xs text-fg-muted" role="status">{queued}</p>}
        <label htmlFor="assistant-input" className="sr-only">
          Message
        </label>
        <textarea
          id="assistant-input"
          ref={box}
          value={input}
          maxLength={MAX}
          rows={3}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask how something works, or describe an agent, flow, tool or skill…"
          className={inputClass("w-full resize-none text-sm")}
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-fg-subtle">Enter to send · Shift+Enter for a new line</span>
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className={buttonClass("secondary", "ml-auto px-3 py-1 text-xs")}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className={buttonClass("primary", "ml-auto px-3 py-1 text-xs")}>
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

/** The person's stored conversations, searchable, grouped by day, across
 *  every workspace they can see. Opening one carries it on. */
function History({ headers, current, onOpen }: { headers: Record<string, string>; current: string | null; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/assistant/conversations?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`, { headers })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { conversations?: ConversationSummary[]; error?: string };
          if (!live) return;
          if (!res.ok) setError(body.error ?? `could not list them (${res.status})`);
          else {
            setError(null);
            setList(body.conversations ?? []);
          }
        })
        .catch(() => live && setError("could not reach the platform"));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, headers, reload]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    if (res.ok) setReload((n) => n + 1);
  };

  return (
    <section aria-label="Conversation history" className="space-y-2">
      <label htmlFor="assistant-history-search" className="sr-only">
        Search conversations
      </label>
      <input
        id="assistant-history-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your conversations…"
        className={inputClass("w-full text-sm")}
        autoFocus
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {list === null && !error && <p className="text-xs text-fg-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-xs text-fg-muted">{q.trim() ? "Nothing matches." : "No conversations yet."}</p>}
      {list &&
        groupConversations(list).map((g) => (
          <div key={g.label}>
            <h3 className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{g.label}</h3>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id} className={`group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-sunken ${c.id === current ? "bg-sunken" : ""}`}>
                  <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-fg">{c.title}</span>
                    <span className="block text-[11px] text-fg-muted">
                      <span className="font-mono">{c.workspace}</span> · {c.messages} message{c.messages === 1 ? "" : "s"}
                      {c.unsaved ? ` · ${c.unsaved} unsaved file${c.unsaved === 1 ? "" : "s"}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete "${c.title}"`}
                    onClick={() => void remove(c.id)}
                    className="invisible text-xs text-fg-subtle hover:text-danger group-hover:visible"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

const EXAMPLES = [
  "How do I run a step only when the previous one found something?",
  "Write an agent that summarises a web page into five bullet points.",
  "Make a flow that runs every Monday at 8 and asks me before it sends anything.",
  "Write a script tool that converts a CSV to JSON.",
  "Turn our house style into a skill.",
];

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-2 text-sm text-fg-secondary">
      <p>
        Ask how foldrun works, or describe what you want built. I read the docs and this workspace&apos;s files, propose agents, flows, tools and
        skills as diffs, and check them before you save.
      </p>
      <ul className="space-y-1">
        {EXAMPLES.map((e) => (
          <li key={e}>
            <button type="button" onClick={() => onPick(e)} className="text-left text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline">
              {e}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({
  message,
  tenant,
  existing,
  busy,
  onCreate,
}: {
  message: ChatMessage;
  tenant: string;
  existing: string[];
  busy: boolean;
  onCreate: (ws: ProposedWorkspace) => void;
}) {
  if (message.role === "user") {
    return <div className="ml-8 whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2 text-sm text-fg">{message.content}</div>;
  }
  if (message.error) {
    return (
      <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
        {message.content}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <Markdown text={linkCitations(message.content)} className="text-sm text-fg" />
      {message.sources && message.sources.length > 0 && (
        <details className="text-[11px] text-fg-muted">
          <summary className="cursor-pointer select-none">Read {message.sources.length} doc section{message.sources.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {message.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
                  {s.doc} › {s.section}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {message.meter && <p className="text-[11px] tabular-nums text-fg-subtle">{message.meter}</p>}
      {message.workspace && <WorkspaceCard proposal={message.workspace} tenant={tenant} exists={existing.includes(message.workspace.name)} busy={busy} onCreate={onCreate} />}
    </div>
  );
}

/** POST /api/workspaces for a blank workspace — what the dashboard's own
 *  "Create workspace" sends — with ifAbsent, so a name that exists (or that
 *  someone creates meanwhile) is refused by the server, never deployed over.
 *  Null when it worked, else the refusal. */
async function createWorkspace(tenant: string, name: string): Promise<string | null> {
  if (!WORKSPACE_NAME.test(name)) return "lower-case letters, digits and dashes";
  try {
    await postCreate("/api/workspaces", tenant, name, { template: true, ifAbsent: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "could not reach the platform";
  }
}

function WorkspaceCard({
  proposal,
  tenant,
  exists,
  busy,
  onCreate,
}: {
  proposal: ProposedWorkspace;
  tenant: string;
  exists: boolean;
  busy: boolean;
  onCreate: (ws: ProposedWorkspace) => void;
}) {
  const mayManage = useCan("workspace:manage");
  const [state, setState] = useState<"idle" | "creating">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-lg border border-line bg-sunken px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-fg">New workspace</span>
        <span className="font-mono text-fg">{proposal.name}</span>
        {exists ? (
          <span className="ml-auto text-fg-muted">exists</span>
        ) : (
          <button
            type="button"
            disabled={busy || state === "creating" || !mayManage}
            title={mayManage ? undefined : needs("workspace:manage")}
            onClick={async () => {
              setState("creating");
              setError(null);
              const refused = await createWorkspace(tenant, proposal.name);
              setState("idle");
              if (refused) setError(refused);
              else onCreate(proposal);
            }}
            className={buttonClass("primary", "ml-auto px-2 py-0.5 text-[11px]")}
          >
            {state === "creating" ? "Creating…" : "Create workspace"}
          </button>
        )}
      </div>
      <p className="mt-1 text-fg-muted">{proposal.purpose}</p>
      {error && <p className="mt-1 text-danger">{error}</p>}
    </section>
  );
}

/** The first workspace of an account, named by hand. */
function CreateWorkspace({ tenant, onCreated }: { tenant: string; onCreated: (ws: string) => void }) {
  const mayManage = useCan("workspace:manage");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const refused = await createWorkspace(tenant, name.trim());
        setBusy(false);
        if (refused) setError(refused);
        else onCreated(name.trim());
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="Workspace name"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="e.g. ads-desk"
          className={inputClass("min-w-0 flex-1 text-sm")}
        />
        <button type="submit" disabled={busy || !name.trim() || !mayManage} title={mayManage ? undefined : needs("workspace:manage")} className={buttonClass("primary", "px-3 py-1 text-xs")}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

function ProposedFile({
  file,
  issues,
  busy,
  saving,
  onSave,
  onDiscard,
}: {
  file: AssistantFile;
  issues: AssistantIssue[];
  busy: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="overflow-hidden rounded-lg border border-line">
      <header className="flex items-center gap-2 border-b border-line-faint bg-sunken px-3 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 truncate text-left font-mono text-xs text-fg">
          {file.path}
        </button>
        <Badge variant={file.before === null ? "success" : "warning"}>{file.before === null ? "new" : "changed"}</Badge>
        <button type="button" disabled={busy} onClick={onDiscard} className={buttonClass("minimal", "ml-auto px-2 py-0.5 text-[11px]")}>
          Discard
        </button>
        <button type="button" disabled={busy} onClick={onSave} className={buttonClass("secondary", "px-2 py-0.5 text-[11px]")}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>
      {issues.length > 0 && (
        <ul className="space-y-1 border-b border-line-faint px-3 py-2">
          {issues.map((i, k) => (
            <li key={k} className={`text-[11px] ${i.level === "error" ? "text-danger" : "text-warning"}`}>
              <span className="font-mono">{i.where}</span> — {i.message}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="max-h-72 overflow-auto">
          <DiffView rows={foldDiff(lineDiff(file.before ?? "", file.content), 4)} empty="Same as the file in the workspace." />
        </div>
      )}
    </section>
  );
}

/** A button that opens the assistant with a message started for the person. */
export function AskAiButton({ prompt, label, title, variant = "secondary" }: { prompt?: string; label: string; title?: string; variant?: "minimal" | "secondary" }) {
  const mayWrite = useCan("workspace:write");
  return (
    <button
      type="button"
      disabled={!mayWrite}
      title={mayWrite ? title : needs("workspace:write")}
      onClick={() => openAssistant(prompt)}
      className={buttonClass(variant, variant === "minimal" ? "px-2 py-1 text-xs" : "")}
    >
      {label}
    </button>
  );
}
