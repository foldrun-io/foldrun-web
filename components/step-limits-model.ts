// A step's `limits:` option as the step options panel edits it: rows of
// key and count, checked before they are written — the same keys core's
// limits.ts reads (web.<action>, web, calls, or a tool the step's agent is
// granted) and the same counts (whole numbers, 1 or more). Pure, so the
// panel and node --test agree; core's parser is still the last word when
// the route writes it (updateFlowStep refuses what parseFlow would flag).

import { WEB_ACTIONS } from "@/lib/providers.ts";

export interface LimitRow {
  key: string;
  count: string;
}

/** The rows a step's limits start the panel with. */
export function limitRows(limits: Record<string, number> | undefined): LimitRow[] {
  return Object.entries(limits ?? {}).map(([key, n]) => ({ key, count: String(n) }));
}

/** What a key may be, in the words the panel shows under it. `granted`
 *  null: the agent's tools are not known here — any tool-shaped name
 *  passes, and `foldrun check` judges it. */
export function limitKeyProblem(key: string, granted: string[] | null): string | null {
  const k = key.trim();
  if (!k) return "a key: web.search, web, calls, or one of this agent's tools";
  if (k === "calls" || k === "web") return null;
  if (k.includes(".")) {
    const [head, action, ...rest] = k.split(".");
    if (head === "web" && !rest.length && (WEB_ACTIONS as readonly string[]).includes(action)) return null;
    return `"${k}" — the dotted keys are ${WEB_ACTIONS.map((a) => `web.${a}`).join(", ")}`;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return `"${k}" is not a key — a tool's name, web.<action>, or calls`;
  if (granted === null) return null;
  const norm = (s: string) => s.trim().replace(/-/g, "_");
  if (granted.some((g) => norm(g) === norm(k))) return null;
  return `"${k}" is not one of this agent's tools${granted.length ? ` (${granted.join(", ")})` : ""}`;
}

export function limitCountProblem(count: string): string | null {
  return /^\s*[1-9]\d*\s*$/.test(count) ? null : "a whole number of calls, 1 or more";
}

/** Every row's problem, or none. Duplicate keys are a problem too. */
export function limitProblems(rows: LimitRow[], granted: string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.key.trim() && !r.count.trim()) continue; // an empty row is nothing
    const k = limitKeyProblem(r.key, granted);
    if (k) out.push(k);
    const c = limitCountProblem(r.count);
    if (c) out.push(`${r.key.trim() || "?"}: ${c}`);
    if (seen.has(r.key.trim())) out.push(`${r.key.trim()} is set twice`);
    seen.add(r.key.trim());
  }
  return out;
}

/** The option's value as the file writes it, or null to clear it. */
export function limitsText(rows: LimitRow[]): string | null {
  const kept = rows.filter((r) => r.key.trim() && r.count.trim());
  return kept.length ? `{${kept.map((r) => `${r.key.trim()}: ${Number(r.count.trim())}`).join(", ")}}` : null;
}

/** The node's chip: the tightest few, e.g. "limits: web.search 10, calls 300". */
export function limitsChip(limits: Record<string, number> | undefined): string | null {
  const pairs = Object.entries(limits ?? {});
  if (!pairs.length) return null;
  const shown = pairs.slice(0, 2).map(([k, n]) => `${k} ${n}`).join(", ");
  return `limits: ${shown}${pairs.length > 2 ? ` +${pairs.length - 2}` : ""}`;
}
