// The assistant panel's logic, without React: reading the streamed reply,
// turning the model's [doc › section] citations into links to the docs
// page, naming the page the person is on, and keeping a conversation in the
// tab. The panel (assistant.tsx) is the drawing; this is what the tests read.

export interface AssistantFile {
  path: string;
  content: string;
  before: string | null;
  sha256: string | null;
}
export interface AssistantIssue {
  where: string;
  message: string;
  level: "error" | "warn";
}
export interface AssistantSource {
  doc: string;
  section: string;
  url: string;
}
export interface ProposedWorkspace {
  name: string;
  purpose: string;
}
export interface AssistantUsage {
  /** All input; the cache fields are the part of it the prompt cache served or stored (absent before 18 Oct 2026). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
}
export interface AssistantReply {
  ok: boolean;
  reply: string;
  files: AssistantFile[];
  issues: AssistantIssue[];
  sources: AssistantSource[];
  supply?: "provider" | "platform" | "mock";
  workspace?: ProposedWorkspace | null;
  usage?: AssistantUsage | null;
  chargedUsd?: number | null;
  /** The stored conversation the reply was kept in. */
  conversation?: string;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: AssistantSource[];
  /** A refusal or a failure, shown as one and never sent back as history. */
  error?: boolean;
  /** A new workspace this reply proposes, with a button to create it. */
  workspace?: ProposedWorkspace | null;
  /** What the reply used and cost, for the line under it. */
  meter?: string | null;
}

/** The line under a reply: tokens, and who paid. */
export function meterLine(r: Pick<AssistantReply, "usage" | "chargedUsd" | "supply">): string | null {
  if (!r.usage) return null;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  const all = r.usage.inputTokens;
  const cached = r.usage.cacheReadTokens !== undefined && all > 0 ? ` (${Math.round((r.usage.cacheReadTokens / all) * 100)}% cached)` : "";
  const tokens = `${k(all)} in${cached} · ${k(r.usage.outputTokens)} out`;
  if (r.supply === "provider") return `${tokens} · on your own model key`;
  if (typeof r.chargedUsd === "number") return `${tokens} · $${r.chargedUsd < 0.01 && r.chargedUsd > 0 ? r.chargedUsd.toFixed(4) : r.chargedUsd.toFixed(2)} charged`;
  return tokens;
}

/** A workspace name the platform takes: kebab-case. */
export const WORKSPACE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** Where a conversation moving into a just-created workspace leaves its
 *  next message, read once by the panel that opens there. */
export const continueKey = (tenant: string) => `foldrun.assistant.${tenant}.continue`;

export type StreamEvent =
  | { event: "status"; text: string }
  | { event: "text"; text: string }
  | { event: "done"; reply: AssistantReply }
  | { event: "error"; error: string; status?: number };

/**
 * Feed text as it arrives; get back the whole events in it and what is left
 * over for next time. An SSE frame is `event:` and `data:` lines and a blank
 * line; `: keepalive` comments are skipped.
 */
export function parseSse(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  // SSE allows CRLF and CR line ends as well as LF; our server writes LF.
  const frames = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    let name = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7).trim();
      else if (line.startsWith("data: ")) data.push(line.slice(6));
      else if (line.startsWith("data:")) data.push(line.slice(5));
    }
    if (!data.length) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.join("\n")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (name === "status" || name === "text") events.push({ event: name, text: String(payload.text ?? "") });
    else if (name === "done") events.push({ event: "done", reply: payload as unknown as AssistantReply });
    else if (name === "error") events.push({ event: "error", error: String(payload.error ?? "the assistant failed"), status: typeof payload.status === "number" ? payload.status : undefined });
  }
  return { events, rest };
}

/** The id the docs page gives a heading — components/markdown.tsx. */
export function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `[flows › Every step option › Routing]` → a link to that heading on the
 *  docs page. A bracket that is already a link, or names no doc, is left. */
export function linkCitations(text: string, docs: ReadonlySet<string> | null = null): string {
  return text.replace(/\[([a-z][a-z0-9-]*)(?:\.md)?((?:\s*›\s*[^\]\n›]+)*)\](?!\()/g, (whole, doc: string, trail: string) => {
    if (docs && !docs.has(doc)) return whole;
    const parts = trail.split("›").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    return `[${[doc, ...parts].join(" › ")}](/dashboard/docs/${doc}${last ? `#${anchorOf(last)}` : ""})`;
  });
}

/** What the person is looking at, from the dashboard URL: `flows`,
 *  `agents/researcher`, `edit (agents/writer/agent.md)`. */
export function pageContext(pathname: string, search: string, workspace: string): string | null {
  const prefix = `/dashboard/${workspace}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+/, "")) || "overview";
  const params = new URLSearchParams(search);
  const file = params.get("path") ?? params.get("file");
  const kind = params.get("kind") ?? params.get("scope");
  return `${rest}${kind ? ` (${kind})` : ""}${file ? ` — ${file}` : ""}`;
}

/** The history the server gets: what was said, not the failures. */
export function historyOf(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.filter((m) => !m.error && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));
}

export const storageKey = (tenant: string, workspace: string) => `foldrun.assistant.${tenant}.${workspace}`;

export interface SavedChat {
  messages: ChatMessage[];
  files: AssistantFile[];
  issues: AssistantIssue[];
  /** The stored conversation this one continues; null until the first reply. */
  conversation: string | null;
}

/** A conversation read back from the tab; anything unreadable is a new one. */
export function readSavedChat(raw: string | null): SavedChat {
  const empty: SavedChat = { messages: [], files: [], issues: [], conversation: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<SavedChat>;
    return {
      messages: Array.isArray(v.messages) ? v.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [],
      files: Array.isArray(v.files) ? v.files.filter((f) => f && typeof f.path === "string" && typeof f.content === "string") : [],
      issues: Array.isArray(v.issues) ? v.issues : [],
      conversation: typeof v.conversation === "string" ? v.conversation : null,
    };
  } catch {
    return empty;
  }
}

/** The issues that belong to one file: `flows/x.md` and `flows/x.md:12`. */
export function issuesFor(issues: AssistantIssue[], path: string): AssistantIssue[] {
  return issues.filter((i) => i.where === path || i.where.startsWith(`${path}:`));
}

/** The note a saved file's revision carries in History. */
export function saveMessage(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  return `written with the assistant: ${first.replace(/\s+/g, " ").trim().slice(0, 80)}`;
}

// ---------------------------------------------------------------- history

/** One stored conversation, as the history list shows it. */
export interface ConversationSummary {
  id: string;
  workspace: string;
  title: string;
  updatedAt: string;
  messages: number;
  /** Proposed files not saved yet when it was last left. */
  unsaved: number;
}

/** A conversation's title: its first question, on one line. */
export function conversationTitle(messages: { role: string; content: string }[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "(empty)";
}

/** The history list in sections a person scans: Today, Yesterday, This
 *  week, Earlier — newest first within each, in the viewer's own day. */
export function groupConversations(list: ConversationSummary[], now: Date = new Date()): { label: string; items: ConversationSummary[] }[] {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOf(now);
  const day = 86_400_000;
  const sections: { label: string; from: number }[] = [
    { label: "Today", from: today },
    { label: "Yesterday", from: today - day },
    { label: "This week", from: today - 6 * day },
    { label: "Earlier", from: -Infinity },
  ];
  const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sections
    .map((s, i) => ({
      label: s.label,
      items: sorted.filter((c) => {
        const t = new Date(c.updatedAt).getTime();
        return t >= s.from && (i === 0 || t < sections[i - 1].from);
      }),
    }))
    .filter((s) => s.items.length);
}

/** A stored message as the panel draws it: the reply's sources, its token
 *  line and any workspace it proposed come back from `meta`. */
export function chatFromStored(m: { role: "user" | "assistant"; content: string; meta?: Record<string, unknown> }): ChatMessage {
  if (m.role === "user" || !m.meta) return { role: m.role, content: m.content };
  const meta = m.meta as Partial<AssistantReply>;
  return {
    role: "assistant",
    content: m.content,
    sources: Array.isArray(meta.sources) ? meta.sources : undefined,
    workspace: meta.workspace ?? null,
    meter: meterLine({ usage: meta.usage ?? null, chargedUsd: meta.chargedUsd ?? null, supply: meta.supply }),
  };
}
