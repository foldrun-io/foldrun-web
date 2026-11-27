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

import { $rich, $t, localizedList } from "@/i18n";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, Textarea } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Chip } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
import { Markdown } from "@/components/markdown";
import { useCan, needs } from "@/components/role";
import { foldDiff, lineDiff } from "@/components/flow-history-model";
import { DiffView } from "@/components/flow-history";
import { postCreate } from "@/components/create";
import { Disclosure } from "@foldrun/ui/react/disclosure";
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
import { Tooltip } from "@foldrun/ui/react/tooltip";

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
    fetch("/v1/workspaces", { headers: { "x-foldrun-tenant": tenant } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { workspaces?: { name: string }[]; error?: string };
        if (!live) return;
        if (!res.ok) setListError(body.error ?? $t("components.assistant.couldNotListWorkspace", { status: String(res.status) }));
        else setWorkspaces((body.workspaces ?? []).map((w) => w.name));
      })
      .catch(() => live && setListError($t("components.assistant.couldNotListWorkspace2")));
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
        // The wrapper holds the fixed position so the tooltip still shows
        // (why it is off) while the button is disabled. On a phone it sat
        // over page buttons; there it is in the bottom bar (PhoneBar).
        <Tooltip label={mayWrite ? $t("components.assistant.askHowFoldrunWorksOrHave") : needs("workspace:write")}>
          <span className="fixed bottom-5 right-5 z-30 inline-flex max-md:hidden">
            <button
              type="button"
              disabled={!mayWrite}
              onClick={() => setOpen(true)}
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "gap-1.5 rounded-full text-[13px] shadow-overlay disabled:opacity-60")}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {$t("components.assistant.askAi")}
            </button>
          </span>
        </Tooltip>
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
            queued={pending ? $t("components.assistant.doctorInOpensWhenThisReply", { ws: String(pending.ws) }) : null}
            onClose={() => {
              // Closing drops a held move: it was asked of this panel.
              setPending(null);
              setOpen(false);
            }}
          />
        ) : (
          <aside role="dialog" aria-label={$t("components.assistant.assistant")} className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-xl sm:w-[440px]">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">{$t("components.assistant.assistant")}</h2>
              <button type="button" onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
                {$t("components.assistant.close")}
              </button>
            </header>
            {workspaces && !listError ? (
              <div className="space-y-2 px-4 py-3 text-sm text-fg-secondary">
                <p>{$t("components.assistant.theAssistantWorksInsideAWorkspace")}</p>
                <CreateWorkspace tenant={tenant} onCreated={created} />
              </div>
            ) : (
              <p className={`px-4 py-3 text-sm ${listError ? "text-danger" : "text-fg-muted"}`}>{listError ?? $t("components.assistant.loading")}</p>
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
    setStatus($t("components.assistant.thinking"));
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
      const res = await fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/assistant`, {
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
        fail(body.error ?? $t("components.assistant.theAssistantRefused", { status: String(res.status) }));
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
      if (!finished) fail($t("components.assistant.theReplyStoppedBeforeItFinished"));
    } catch (err) {
      if (!finished) fail(controller.signal.aborted ? $t("components.assistant.stoppedTheReplyStillFinishesOn") : err instanceof Error ? err.message : $t("components.assistant.theAssistantCouldNotBeReached"));
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
          setMessages((m) => [...m, { role: "assistant", content: r.reply || $t("components.assistant.noAnswer"), sources: r.sources, workspace: r.workspace ?? null, meter: meterLine(r) }]);
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
        next = $t("components.assistant.theWorkspaceNowExistsAndYou", { workspace: String(workspace) });
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
        JSON.stringify({ messages: [...messages.slice(-38), { role: "assistant", content: $t("components.assistant.createdTheWorkspace", { name: String(ws.name) }) }], files: [], issues: [] }),
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
        const res = await fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/source`, {
          method: "PUT",
          headers,
          // A new file expects none there (ifMatch: null): one created since
          // the proposal is refused, not overwritten.
          body: JSON.stringify({ path: f.path, content: f.content, message: note, ifMatch: f.sha256 ?? null }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            `${f.path}: ${res.status === 409 ? $t("components.assistant.sinceThisWasProposedAskThe", { v0: String(f.before === null ? $t("components.assistant.someoneCreatedIt") : $t("components.assistant.itChanged")) }) : (body.error ?? $t("components.assistant.refused", { status: String(res.status) }))}`,
          );
        }
        done.push(f.path);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : $t("components.assistant.saveFailed"));
    } finally {
      if (done.length) {
        setFiles((fs) => fs.filter((f) => !done.includes(f.path)));
        setIssues((is) => is.filter((i) => !done.some((p) => i.where === p || i.where.startsWith(`${p}:`))));
        setMessages((m) => [...m, { role: "assistant", content: $t("components.assistant.savedEachIsARevisionIn", { v0: String(done.map((p) => `\`${p}\``).join(", ")) }) }]);
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
      const res = await fetch(`/v1/assistant/conversations/${encodeURIComponent(id)}`, { headers });
      const c = (await res.json().catch(() => ({}))) as {
        id?: string;
        workspace?: string;
        messages?: { role: "user" | "assistant"; content: string; meta?: Record<string, unknown> }[];
        files?: AssistantFile[];
        error?: string;
      };
      if (!res.ok || !c.id || !c.workspace) {
        setSaveError(c.error ?? $t("components.assistant.couldNotOpenIt", { status: String(res.status) }));
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
      setSaveError($t("components.assistant.couldNotReachThePlatform"));
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
      aria-label={$t("components.assistant.assistant")}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-xl sm:w-[440px]"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            {$rich("components.assistant.assistantIn", { span: (chunks) => <span className="font-normal text-fg-muted">{chunks}</span> })}
            {workspaces.length > 1 ? (
              <Select
                size="sm"
                aria-label={$t("components.assistant.assistantSWorkspace")}
                value={workspace}
                disabled={busy}
                onChange={(e) => onPick(e.target.value)}
                className="max-w-[12rem]"
                selectClassName="h-6 truncate pl-1.5 pr-7 text-xs font-medium"
              >
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="font-mono text-xs">{workspace}</span>
            )}
          </h2>
          <p className="text-[11px] text-fg-muted">{$t("components.assistant.answersFromTheFoldrunDocsNothing")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          disabled={busy}
          aria-pressed={showHistory}
          className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}
        >
          {$t("components.assistant.history")}
        </button>
        <button type="button" onClick={reset} disabled={busy || (!messages.length && !files.length)} className={buttonVariants({ variant: "ghost", size: "xs" })}>
          {$t("components.assistant.newChat")}
        </button>
        <button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "xs" })}>
          {$t("components.assistant.close")}
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
          <section aria-label={$t("components.assistant.proposedFiles")} className="space-y-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-fg">
                {$t("components.assistant.proposedFile", { length: files.length })}
              </span>
              {errors === 0 ? <Chip tone="good">{$t("components.assistant.passesTheCheck")}</Chip> : <Chip tone="bad">{$t("components.assistant.error", { errors: errors })}</Chip>}
              {files.length > 1 && (
                <button
                  type="button"
                  disabled={busy || saving !== null}
                  onClick={() => void save(files)}
                  className={cn(buttonVariants({ variant: "primary", size: "xs" }), "ml-auto")}
                >
                  {saving === "all" ? $t("components.assistant.saving") : $t("components.assistant.saveAll", { length: String(files.length) })}
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
          {$t("components.assistant.message")}
        </label>
        <Textarea
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
          placeholder={$t("components.assistant.askHowSomethingWorksOrDescribe")}
          className="w-full resize-none text-sm"
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-fg-subtle">{$t("components.assistant.enterToSendShiftEnterFor")}</span>
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className={cn(buttonVariants({ variant: "secondary", size: "xs" }), "ml-auto")}>
              {$t("components.assistant.stop")}
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className={cn(buttonVariants({ variant: "primary", size: "xs" }), "ml-auto")}>
              {$t("components.assistant.send")}
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
      fetch(`/v1/assistant/conversations?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`, { headers })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { conversations?: ConversationSummary[]; error?: string };
          if (!live) return;
          if (!res.ok) setError(body.error ?? $t("components.assistant.couldNotListThem", { status: String(res.status) }));
          else {
            setError(null);
            setList(body.conversations ?? []);
          }
        })
        .catch(() => live && setError($t("components.assistant.couldNotReachThePlatform")));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, headers, reload]);

  const remove = async (id: string) => {
    const res = await fetch(`/v1/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    if (res.ok) setReload((n) => n + 1);
  };

  return (
    <section aria-label={$t("components.assistant.conversationHistory")} className="space-y-2">
      <label htmlFor="assistant-history-search" className="sr-only">
        {$t("components.assistant.searchConversations")}
      </label>
      <Input
        id="assistant-history-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={$t("components.assistant.searchYourConversations")}
        className="w-full text-sm"
        autoFocus
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {list === null && !error && <p className="text-xs text-fg-muted">{$t("components.assistant.loading")}</p>}
      {list?.length === 0 && <p className="text-xs text-fg-muted">{q.trim() ? $t("components.assistant.nothingMatches") : $t("components.assistant.noConversationsYet")}</p>}
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
                      {$rich("components.assistant.message2", { workspace: c.workspace, span: (chunks) => <span className="font-mono">{chunks}</span>, messages: c.messages })}
                      {c.unsaved ? $t("components.assistant.unsavedFile", { unsaved: String(c.unsaved), v1: c.unsaved }) : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={$t("components.assistant.delete", { title: String(c.title) })}
                    onClick={() => void remove(c.id)}
                    className="invisible text-xs text-fg-subtle hover:text-danger group-hover:visible"
                  >
                    {$t("components.assistant.delete2")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

const EXAMPLES = localizedList(() => [
  $t("components.assistant.howDoIRunAStep"),
  $t("components.assistant.writeAnAgentThatSummarisesA"),
  $t("components.assistant.makeAFlowThatRunsEvery"),
  $t("components.assistant.writeAScriptToolThatConverts"),
  $t("components.assistant.turnOurHouseStyleIntoA"),
]);

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-2 text-sm text-fg-secondary">
      <p>
        {$t("components.assistant.askHowFoldrunWorksOrDescribe")}
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
        <Disclosure className="text-[11px] text-fg-muted" summaryClassName="select-none" summary={<>{$t("components.assistant.readDocSection", { length: message.sources.length })}</>}>
          <ul className="mt-1 space-y-0.5 pl-3">
            {message.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
                  {s.doc} › {s.section}
                </a>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {message.meter && <p className="text-[11px] tabular-nums text-fg-subtle">{message.meter}</p>}
      {message.workspace && <WorkspaceCard proposal={message.workspace} tenant={tenant} exists={existing.includes(message.workspace.name)} busy={busy} onCreate={onCreate} />}
    </div>
  );
}

/** POST /v1/workspaces for a blank workspace — what the dashboard's own
 *  "Create workspace" sends — with ifAbsent, so a name that exists (or that
 *  someone creates meanwhile) is refused by the server, never deployed over.
 *  Null when it worked, else the refusal. */
async function createWorkspace(tenant: string, name: string): Promise<string | null> {
  if (!WORKSPACE_NAME.test(name)) return $t("components.assistant.lowerCaseLettersDigitsAndDashes");
  try {
    await postCreate("/v1/workspaces", tenant, name, { template: true, ifAbsent: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : $t("components.assistant.couldNotReachThePlatform");
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
        <span className="font-medium text-fg">{$t("components.assistant.newWorkspace")}</span>
        <span className="font-mono text-fg">{proposal.name}</span>
        {exists ? (
          <span className="ml-auto text-fg-muted">{$t("components.assistant.exists")}</span>
        ) : (
          <Tooltip label={mayManage ? undefined : needs("workspace:manage")}>
            <span className="ml-auto inline-flex">
              <button
                type="button"
                disabled={busy || state === "creating" || !mayManage}
                onClick={async () => {
                  setState("creating");
                  setError(null);
                  const refused = await createWorkspace(tenant, proposal.name);
                  setState("idle");
                  if (refused) setError(refused);
                  else onCreate(proposal);
                }}
                className={buttonVariants({ variant: "primary", size: "xs" })}
              >
                {state === "creating" ? $t("components.assistant.creating") : $t("components.assistant.createWorkspace")}
              </button>
            </span>
          </Tooltip>
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
        <Input
          aria-label={$t("components.assistant.workspaceName")}
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="e.g. ads-desk"
          className="min-w-0 flex-1 text-sm"
        />
        <Tooltip label={mayManage ? undefined : needs("workspace:manage")}>
          <span className="inline-flex">
            <button type="submit" disabled={busy || !name.trim() || !mayManage} className={buttonVariants({ variant: "primary", size: "md" })}>
              {busy ? $t("components.assistant.creating") : $t("components.assistant.create")}
            </button>
          </span>
        </Tooltip>
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
        <Chip tone={file.before === null ? "good" : "warn"}>{file.before === null ? $t("values.fileChange.new") : $t("values.fileChange.changed")}</Chip>
        <button type="button" disabled={busy} onClick={onDiscard} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto")}>
          {$t("components.assistant.discard")}
        </button>
        <button type="button" disabled={busy} onClick={onSave} className={buttonVariants({ variant: "secondary", size: "xs" })}>
          {saving ? $t("components.assistant.saving") : $t("components.assistant.save")}
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
          <DiffView rows={foldDiff(lineDiff(file.before ?? "", file.content), 4)} empty={$t("components.assistant.sameAsTheFileInThe")} />
        </div>
      )}
    </section>
  );
}

/** A button that opens the assistant with a message started for the person. */
export function AskAiButton({ prompt, label, title, variant = "secondary" }: { prompt?: string; label: string; title?: string; variant?: "minimal" | "secondary" }) {
  const mayWrite = useCan("workspace:write");
  return (
    <Tooltip label={mayWrite ? title : needs("workspace:write")}>
      <span className="inline-flex">
        <button
          type="button"
          disabled={!mayWrite}
          onClick={() => openAssistant(prompt)}
          className={variant === "minimal" ? buttonVariants({ variant: "ghost", size: "xs" }) : buttonVariants({ variant: "secondary" })}
        >
          {label}
        </button>
      </span>
    </Tooltip>
  );
}
