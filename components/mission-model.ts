// Mission control: the account's runs read three ways — what is going on
// now, what needs a person, and each desk's heartbeat. Pure: the page
// reduces every run to a RunLite on the server (where the store's helpers
// live) and these functions shape them, so tests reach every rule.

import { platformCause, isActiveIssue, type Issue, type PlatformCause } from "@/lib/issues";
import { isLive, needsAttention, tally, type Outcome, type Tally } from "@/components/outcome-model";

export interface RunLite {
  workspace: string;
  id: string;
  /** What ran: a flow's name, or "agent: x" for a direct agent run. */
  what: string;
  outcome: Outcome;
  startedAt: string;
  finishedAt: string | null;
  headline: string | null;
  failure: { agent: string; reason: string } | null;
  steps: number;
  /** Steps finished, and the one running now (1-based), with its agent. */
  done: number;
  active: { index: number; agent: string } | null;
  /** What the run is charged, in USD: the ledger's line once settled, its
   *  list price until then (`charged` false) — never the token cost. */
  costUsd: number;
  charged?: boolean;
  /** The revision it ran (RunRecord.revision). */
  revision?: string | null;
  /** A question the running step asked a person and is waiting on. */
  question?: string;
}

/** A run still going for longer than this is called stuck. */
export const STUCK_MS = 60 * 60_000;
export const DAY_MS = 24 * 60 * 60_000;

export interface NowItem extends RunLite {
  elapsedMs: number;
  stuck: boolean;
}

/** Everything running, queued or waiting for a person, longest-running first. */
export function nowBoard(runs: RunLite[], now: number): NowItem[] {
  return runs
    .filter((r) => isLive(r.outcome))
    .map((r) => {
      const elapsedMs = Math.max(0, now - Date.parse(r.startedAt));
      return { ...r, elapsedMs, stuck: r.outcome === "running" && elapsedMs > STUCK_MS };
    })
    .sort((a, b) => b.elapsedMs - a.elapsedMs);
}

export interface AttentionItem {
  workspace: string;
  what: string;
  /** The newest such run; the one to open. A missed schedule has none. */
  run?: RunLite;
  /** Where the item opens when there is no run: a missed schedule's flow. */
  href?: string;
  /** How many runs of the same thing ended this way in the window. */
  count: number;
  kind: "platform" | "failed" | "bad" | "blocked" | "stuck" | "waiting" | "missed";
  /** One line: why. */
  reason: string;
  ageMs: number;
  /** For a platform item: every desk it hit. */
  desks?: string[];
  /** The issue this item is (FOL-54): failures, BLOCKED, BAD and platform
   *  causes are issues, kept open until a person resolves them. */
  issue?: Issue;
  /** For an issue: how long since it was first seen, and since the flow's
   *  newest good run (null when there is none since). */
  sinceMs?: number;
  fineMs?: number | null;
}

const RANK: Record<AttentionItem["kind"], number> = { platform: 0, waiting: 1, stuck: 2, missed: 3, failed: 4, bad: 5, blocked: 6 };

// The platform causes moved to core issues.ts (FOL-54 step 3), where issues
// group by them; re-exported so this module's callers are unchanged.
export { platformCause, type PlatformCause };

/** What a person should look at: in the last day, every flow or agent whose
 *  newest run failed, went BAD or BLOCKED; anything stuck; anything waiting
 *  for an approval. A thing that recovered — its newest run is fine — is
 *  not listed. Grouped per workspace and thing, newest run carried. */
export function attention(runs: RunLite[], now: number): AttentionItem[] {
  const newest = new Map<string, RunLite>();
  const counts = new Map<string, number>();
  for (const r of runs) {
    const key = `${r.workspace}\u0000${r.what}`;
    const cur = newest.get(key);
    if (!cur || r.startedAt > cur.startedAt) newest.set(key, r);
    if (needsAttention(r.outcome) && now - Date.parse(r.startedAt) <= DAY_MS) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: AttentionItem[] = [];
  const platform = new Map<string, { cause: PlatformCause; runs: RunLite[] }>();
  for (const [key, r] of newest) {
    const ageMs = Math.max(0, now - Date.parse(r.finishedAt ?? r.startedAt));
    if (r.outcome === "waiting") {
      out.push({
        workspace: r.workspace, what: r.what, run: r, count: 1, kind: "waiting",
        reason: r.question
          ? `${r.active?.agent ?? "the agent"} asks: ${r.question}`
          : r.active ? `step ${r.active.index} · ${r.active.agent} is waiting for your approval` : "waiting for your approval",
        ageMs,
      });
    } else if (r.outcome === "running" && now - Date.parse(r.startedAt) > STUCK_MS) {
      out.push({ workspace: r.workspace, what: r.what, run: r, count: 1, kind: "stuck", reason: `running for ${Math.round((now - Date.parse(r.startedAt)) / 60_000)} min${r.active ? ` — on step ${r.active.index} · ${r.active.agent}` : ""}`, ageMs: now - Date.parse(r.startedAt) });
    } else if (needsAttention(r.outcome) && now - Date.parse(r.startedAt) <= DAY_MS) {
      const cause = r.outcome === "failed" ? platformCause(r.failure?.reason) : null;
      if (cause) {
        const b = platform.get(cause.key) ?? { cause, runs: [] };
        b.runs.push(r);
        platform.set(cause.key, b);
        continue;
      }
      const reason = r.failure ? `${r.failure.agent}: ${r.failure.reason}` : r.headline ?? r.outcome;
      out.push({ workspace: r.workspace, what: r.what, run: r, count: counts.get(key) ?? 1, kind: r.outcome as "failed" | "bad" | "blocked", reason, ageMs });
    }
  }
  for (const { cause, runs: hit } of platform.values()) {
    const newestRun = hit.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
    const desks = [...new Set(hit.map((r) => r.workspace))].sort();
    out.push({
      workspace: newestRun.workspace,
      what: cause.label,
      run: newestRun,
      count: hit.length,
      kind: "platform",
      reason: `Fix ${cause.fix}`,
      ageMs: Math.max(0, now - Date.parse(newestRun.finishedAt ?? newestRun.startedAt)),
      desks,
    });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.ageMs - b.ageMs);
}

export interface Heartbeat {
  workspace: string;
  /** Oldest first, at most `n`: the cells to draw. */
  cells: RunLite[];
  last: RunLite | null;
  /** Of the completed + failed runs in the cells, the share that completed (stopped left out). */
  rate: number | null;
  /** The counts behind it (FOL-54: Home shows counts, not percentages). */
  tally: Tally;
  runs24h: number;
  spend7dUsd: number;
  live: number;
}

/** Each workspace's last `n` runs as a strip, with the numbers beside it.
 *  Workspaces with something live or wrong come first, then by last run. */
export function heartbeats(workspaces: string[], runs: RunLite[], now: number, n = 24, keyOf: (r: RunLite) => string = (r) => r.workspace): Heartbeat[] {
  const by = new Map<string, RunLite[]>(workspaces.map((w) => [w, []]));
  for (const r of runs) by.get(keyOf(r))?.push(r);
  const out: Heartbeat[] = [];
  for (const [workspace, list] of by) {
    const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const cells = sorted.slice(-n);
    // The shared completion rate (core outcome.ts), as on every other page.
    const t = tally(cells.map((r) => r.outcome));
    out.push({
      workspace,
      cells,
      last: sorted[sorted.length - 1] ?? null,
      rate: t.finished ? t.completed / t.finished : null,
      tally: t,
      runs24h: list.filter((r) => now - Date.parse(r.startedAt) <= DAY_MS).length,
      spend7dUsd: list.filter((r) => now - Date.parse(r.startedAt) <= 7 * DAY_MS).reduce((s, r) => s + r.costUsd, 0),
      live: list.filter((r) => isLive(r.outcome)).length,
    });
  }
  const weight = (h: Heartbeat) => (h.live ? 0 : h.last && needsAttention(h.last.outcome) ? 1 : 2);
  return out.sort((a, b) => weight(a) - weight(b) || (b.last?.startedAt ?? "").localeCompare(a.last?.startedAt ?? ""));
}

/** The same strips keyed by flow, for one workspace's flows table. The key
 *  is `what`, which for a flow run is the flow's name. Kept in the flows'
 *  own order, not the desks' attention order. */
export function flowStrips(flows: string[], runs: RunLite[], now: number, n = 12): Map<string, Heartbeat> {
  return new Map(heartbeats(flows, runs, now, n, (r) => r.what).map((h) => [h.workspace, h]));
}

/** Money spent by runs started in the last `ms`. */
export function spendWithin(runs: RunLite[], now: number, ms: number): number {
  return runs.filter((r) => now - Date.parse(r.startedAt) <= ms).reduce((s, r) => s + r.costUsd, 0);
}

/** "4m", "2h 5m", "3d" — how long, compactly. A negative span (a start
 *  stamped ahead of this clock) is "0s", never "-14351s". */
export function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

/** The issues still asking for someone, as attention items: the newest run
 *  to open, and the issue for its count, history and buttons. */
export function issueItems(issues: Issue[], runs: RunLite[], now: number): AttentionItem[] {
  const byId = new Map(runs.map((r) => [`${r.workspace}\u0000${r.id}`, r]));
  const out: AttentionItem[] = [];
  for (const i of issues) {
    if (!isActiveIssue(i)) continue;
    const newest = i.runs[0];
    const run = newest && !newest.missed ? byId.get(`${newest.workspace}\u0000${newest.id}`) : undefined;
    // A missed schedule has no run: it opens the flow instead.
    if (!run && i.kind !== "missed") continue;
    out.push({
      workspace: i.workspace,
      what: i.what,
      ...(run ? { run } : { href: `/dashboard/${encodeURIComponent(i.workspace)}/flows?flow=${encodeURIComponent(i.what)}` }),
      count: i.count,
      kind: i.kind,
      reason: i.kind === "platform" ? i.action : i.reason,
      ageMs: Math.max(0, now - Date.parse(i.lastSeen)),
      ...(i.kind === "platform" ? { desks: i.workspaces } : {}),
      issue: i,
      sinceMs: Math.max(0, now - Date.parse(i.firstSeen)),
      fineMs: i.recoveredAt ? Math.max(0, now - Date.parse(i.recoveredAt)) : null,
    });
  }
  return out;
}

/** What Home lists (FOL-54): what is waiting on a person or stuck right now,
 *  and every issue still open — however old, and whatever ran since. */
export function needsList(runs: RunLite[], issues: Issue[], now: number): AttentionItem[] {
  const live = attention(runs, now).filter((a) => a.kind === "waiting" || a.kind === "stuck");
  return [...live, ...issueItems(issues, runs, now)].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.ageMs - b.ageMs);
}
