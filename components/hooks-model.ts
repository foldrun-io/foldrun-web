// What hooks did lately, read off the runs. Every line a hook wrote carries a
// `hook` record (core hooks.ts HookRecord, store.ts RunEvent.hook): a deny, a
// rewrite, context, a reply, a note, a failure. The Hooks page and the API
// list them; the run page badges them. Pure, so the rules are tested.

export interface HookRecordLike {
  hook: string;
  event: string;
  did: string;
  tool?: string;
  reason?: string;
  ms: number;
}

type RunLike = {
  id: string;
  flow: string;
  startedAt: string;
  steps: { agent: string; events?: { t: string; hook?: HookRecordLike }[] }[];
};

export interface HookActivity {
  runId: string;
  flow: string;
  agent: string;
  /** 1-based, as the run page numbers steps. */
  step: number;
  t: string;
  record: HookRecordLike;
}

/** What a person comes to the page for: a hook stopping or changing something,
 *  or failing. Context, replies and notes are the hook doing its job quietly. */
export const LOUD: ReadonlySet<string> = new Set(["deny", "rewrite", "error"]);

/** Hook records across these runs, newest first. `loud` keeps deny, rewrite
 *  and error only. */
export function hookActivity(runs: RunLike[], opts: { limit?: number; loud?: boolean } = {}): HookActivity[] {
  const out: HookActivity[] = [];
  for (const run of runs) {
    run.steps.forEach((step, i) => {
      for (const e of step.events ?? []) {
        if (!e.hook || typeof e.hook.hook !== "string") continue;
        if (opts.loud && !LOUD.has(e.hook.did)) continue;
        out.push({ runId: run.id, flow: run.flow, agent: step.agent, step: i + 1, t: e.t || run.startedAt, record: e.hook });
      }
    });
  }
  out.sort((a, b) => b.t.localeCompare(a.t));
  return opts.limit != null ? out.slice(0, opts.limit) : out;
}

export interface HookTally {
  deny: number;
  rewrite: number;
  error: number;
  other: number;
  last: string | null;
}

/** Per hook name: how often it denied, rewrote, failed, and when it last acted. */
export function hookTally(activity: HookActivity[]): Map<string, HookTally> {
  const out = new Map<string, HookTally>();
  for (const a of activity) {
    const t = out.get(a.record.hook) ?? { deny: 0, rewrite: 0, error: 0, other: 0, last: null };
    if (a.record.did === "deny") t.deny++;
    else if (a.record.did === "rewrite") t.rewrite++;
    else if (a.record.did === "error") t.error++;
    else t.other++;
    if (!t.last || a.t > t.last) t.last = a.t;
    out.set(a.record.hook, t);
  }
  return out;
}

/** The badge a hook line wears on the run page and the Hooks page. */
export function hookBadge(r: Pick<HookRecordLike, "hook" | "did">): { label: string; tone: "error" | "warn" | "info" | "muted" } {
  switch (r.did) {
    case "deny": return { label: `${r.hook} denied`, tone: "error" };
    case "error": return { label: `${r.hook} failed`, tone: "error" };
    case "rewrite": return { label: `${r.hook} rewrote`, tone: "warn" };
    case "context": return { label: `${r.hook} added context`, tone: "info" };
    case "reply": return { label: `${r.hook} rewrote the reply`, tone: "warn" };
    default: return { label: r.hook, tone: "muted" };
  }
}

/** Tailwind classes per tone — palette colours the dark theme re-points. */
export const HOOK_TONE: Record<ReturnType<typeof hookBadge>["tone"], string> = {
  error: "bg-red-50 text-red-700 ring-red-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  muted: "bg-muted text-fg-tertiary ring-line",
};
