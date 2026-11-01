// A2A on the dashboard (1 Nov 2026): the pure half of the flow page's
// "Publish over A2A" control, the workspace's A2A panel and the "A2A · <key>"
// run label. No React, no fetch — tests/a2a-model.test.ts reads it, and the
// flow PATCH route merges an `a2a` edit with the same a2aPatch.

import { a2aPublishProblems } from "@/lib/a2a-publish";

/** The `a2a:` keys a PATCH may set, as the file spells them. */
const KEYS = ["publish", "name", "description", "examples", "public_card", "input"] as const;

/**
 * An `a2a` edit merged over what the flow's `a2a:` says now: a key the
 * caller sent replaces it, a key sent as null (or "") goes, a key not sent
 * is kept — so `{ publish: false }` unpublishes and keeps the card's words.
 * `null` removes the whole block. The result must read (a2aPublishProblems)
 * or the edit is refused: a block that does not read publishes nothing, and
 * the dashboard must not write one.
 */
export function a2aPatch(given: unknown, current: unknown): { value: Record<string, unknown> | null } | { error: string } {
  if (given === null) return { value: null };
  if (typeof given !== "object" || Array.isArray(given)) return { error: "a2a must be { publish, name?, description?, examples?, public_card?, input? } or null" };
  const o = given as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (unknown.length) return { error: `a2a: ${unknown.map((k) => `\`${k}\``).join(", ")} is not one of ${KEYS.join(", ")}` };
  const out: Record<string, unknown> = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  for (const k of KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null || v === "" || (k === "examples" && Array.isArray(v) && v.length === 0)) delete out[k];
    else out[k] = typeof v === "string" ? v.trim() : v;
  }
  // A new block with nothing said about publishing is a draft, not a publish.
  if (!("publish" in out)) out.publish = false;
  const problems = a2aPublishProblems(out);
  if (problems.length) return { error: `a2a: ${problems.join("; ")}` };
  return { value: out };
}

/** What the form edits, read from the flow's parsed `a2a:` (FlowInfo.a2a). */
export interface A2aForm {
  publish: boolean;
  name: string;
  description: string;
  /** One example request per line. */
  examples: string;
  publicCard: boolean;
}

export function a2aFormOf(pub: { publish: boolean; name: string | null; description: string | null; examples: string[]; publicCard: boolean } | null | undefined): A2aForm {
  return {
    publish: pub?.publish ?? false,
    name: pub?.name ?? "",
    description: pub?.description ?? "",
    examples: (pub?.examples ?? []).join("\n"),
    publicCard: pub?.publicCard ?? false,
  };
}

/** The PATCH body the form sends: every key the form owns, blanks as null
 *  so they go; `input:` is not the form's and is never sent (kept). */
export function a2aBodyOf(f: A2aForm): Record<string, unknown> {
  const examples = f.examples.split("\n").map((e) => e.trim()).filter(Boolean);
  return {
    publish: f.publish,
    name: f.name.trim() || null,
    description: f.description.trim() || null,
    examples: examples.length ? examples : null,
    public_card: f.publicCard ? true : null,
  };
}

/** A shell-safe single-quoted string. */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A curl that sends one message to a published flow and waits for its
 * answer: A2A 1.0 JSON-RPC, the A2A-Version header, the A2A key from an
 * environment variable (never written into the page).
 */
export function a2aCurl(endpoint: string, opts: { text?: string; keyEnv?: string; messageId?: string } = {}): string {
  const env = opts.keyEnv ?? "FOLDRUN_A2A_KEY";
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: { messageId: opts.messageId ?? "msg-1", role: "ROLE_USER", parts: [{ text: opts.text ?? "Hello" }] },
    },
  };
  return [
    `curl -sS ${sq(endpoint)} \\`,
    `  -H "authorization: Bearer $${env}" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'A2A-Version: 1.0' \\`,
    `  -d ${sq(JSON.stringify(body))}`,
  ].join("\n");
}

/** A run an outside agent started: "A2A · <key label>". The key is the A2A
 *  key's principal (RunRecord.a2a.key); `labels` maps principals to labels
 *  (GET /api/keys, or the A2A view's tasks). Null for every other run. */
export function a2aRunLabel(run: { trigger?: string; a2a?: { key: string } | null }, labels: Record<string, string | null | undefined> = {}): string | null {
  if (run.trigger !== "a2a" && !run.a2a) return null;
  const key = run.a2a?.key;
  const label = (key && labels[key]?.trim()) || null;
  return label ? `A2A · ${label}` : "A2A · an outside agent";
}

/** The principal → label map from a key list (GET /api/keys or listApiKeys):
 *  every key of a rotation chain shares its first id, and the live one's
 *  label wins. */
export function a2aKeyLabels(keys: { id: string; label: string; purpose?: string; revokedAt?: string | null; a2a?: { principal?: string } | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (k.purpose !== "a2a") continue;
    const principal = k.a2a?.principal || k.id;
    if (!out[principal] || !k.revokedAt) out[principal] = k.label || out[principal] || "";
  }
  return out;
}

/** A task state as a person reads it: TASK_STATE_WORKING → working. */
export function a2aStateWord(state: string): string {
  return state.replace(/^TASK_STATE_/, "").replace(/_/g, " ").toLowerCase();
}
