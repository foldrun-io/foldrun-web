// A step's trace, sorted into what a person reads it for. The runner writes
// one stream — the agent's words, tool calls, verify results, errors, and a
// lot of plumbing (egress, timings, images) — and a single grey box made the
// plumbing as loud as the answer. Pure, so the rules are tested.

export type TraceKind = "agent" | "tool" | "verify" | "error" | "system";

export interface TraceLine {
  kind: TraceKind;
  text: string;
  /** For a tool: its name, and what it was called with, split. */
  tool?: { name: string; args: string };
  /** For a verify line: whether it held. */
  ok?: boolean;
  durationMs?: number;
  /** Made by a sub-agent (`subagents:`) on this step's behalf — its name. */
  subagent?: string;
  /** Written by a hook (core hooks.ts): which one, and what it did. */
  hook?: { hook: string; did: string; event: string; tool?: string };
  /** The tool call's id, when its input and output were recorded (FOL-54). */
  call?: string;
}

const SYSTEM = /^(egress:|timing:|resources:|image |script executor|mcp server|isolation:|step started|sandbox|files: saved|runtime:|cache:|lease |model:|budget:|context:)/i;

type HookField = { hook: string; did: string; event: string; tool?: string };

export function classify(e: { type: string; text: string; err?: boolean; durationMs?: number; subagent?: string; hook?: HookField; call?: string; captured?: boolean }): TraceLine {
  let line = classifyEvent(e);
  if (e.subagent) line = { ...line, subagent: e.subagent };
  if (e.captured && e.call && line.tool) line = { ...line, call: e.call };
  if (e.hook && typeof e.hook.hook === "string") {
    // A rewrite or a note is an info line, which would otherwise sort as
    // plumbing — but a hook changing a call is the opposite of plumbing.
    // It reads with the tool calls it acted on; a deny or a failure is
    // already an error line.
    line = { ...line, ...(line.kind === "system" ? { kind: "tool" as const } : {}), hook: { hook: e.hook.hook, did: e.hook.did, event: e.hook.event, ...(e.hook.tool ? { tool: e.hook.tool } : {}) } };
  }
  return line;
}

function classifyEvent(e: { type: string; text: string; err?: boolean; durationMs?: number }): TraceLine {
  const text = e.text ?? "";
  if (e.type === "text") return { kind: "agent", text };
  if (e.type === "error" || e.err) {
    if (e.type === "tool") return { kind: "error", text, tool: splitTool(text), durationMs: e.durationMs };
    return { kind: "error", text };
  }
  if (e.type === "tool") return { kind: "tool", text, tool: splitTool(text), durationMs: e.durationMs };
  // A verify line: "verify `…` → matched" / "→ failed …".
  const v = text.match(/^verify\b[\s\S]*?→\s*(\S+)/i);
  if (v) return { kind: "verify", text, ok: !/fail|not |no match|mismatch|✗/i.test(v[1]) && !/→\s*(failed|not)/i.test(text) };
  // A script tool's own line: "script: web(action=browse, url=…) → exit 0 (18071ms, sandbox)".
  const s = text.match(/^script:\s*([\w.-]+)\(([\s\S]*)\)\s*→\s*exit\s+(\d+)(?:\s*\((\d+)ms)?/);
  if (s) {
    const line: TraceLine = { kind: s[3] === "0" ? "tool" : "error", text, tool: { name: s[1], args: s[2] } };
    if (s[4]) line.durationMs = Number(s[4]);
    return line;
  }
  if (SYSTEM.test(text)) return { kind: "system", text };
  return { kind: "system", text };
}

/** "web(action=fetch, url=…)" or "mcp__foldrun_scripts__web" → name and arguments. */
export function splitTool(text: string): { name: string; args: string } {
  const m = text.match(/^([\w.:-]+)\s*\(([\s\S]*)\)\s*$/) ?? text.match(/^([\w.:-]+)\s*[:\s]\s*([\s\S]*)$/);
  const raw = m ? m[1] : text;
  const name = raw.replace(/^mcp__[a-z0-9_]+?__/i, "");
  return { name, args: m ? m[2].trim() : "" };
}

export function counts(lines: TraceLine[]): Record<TraceKind | "all", number> {
  const c = { all: lines.length, agent: 0, tool: 0, verify: 0, error: 0, system: 0 };
  for (const l of lines) c[l.kind]++;
  return c;
}
