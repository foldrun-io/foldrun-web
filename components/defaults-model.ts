// The defaults a scope's AGENTS.md frontmatter can set from a form —
// timezone, notify, budget — read out of the frontmatter and checked on the
// way back in. Shared by the two PATCH routes and the forms, so one rule
// says what a valid budget or a valid notify is. tests/defaults.test.ts.

import { parseBudget, budgetProblem, formatBudget, type Budget } from "../../foldrun-core/src/budget.ts";
import { parseTelemetry, type TelemetryConfig } from "../../foldrun-core/src/otel-config.ts";
import { parseAlerts } from "../../foldrun-core/src/alerts.ts";
import { parseJudge } from "../../foldrun-core/src/judge-verdict.ts";

/** `alerts:` as written — the form shows and saves the words a person typed
 *  (`30%`), not the parsed fraction. */
export type Alerts = Partial<Record<"failure_rate" | "min_runs" | "credits_day" | "run_minutes" | "stale_days" | "cost_spike" | "runs_per_hour", string | number>> & { new_host?: boolean };
export const ALERT_KEYS = ["failure_rate", "min_runs", "credits_day", "run_minutes", "stale_days", "cost_spike", "runs_per_hour", "new_host"] as const;

export interface Judge {
  model?: string;
  effort?: string;
}

export type { TelemetryConfig };

export type { Budget };

export interface Notify {
  url?: string;
  email?: string;
  events: string[];
}

export interface Defaults {
  timezone: string | null;
  /** A cap over a day, week or month, or null for no limit. */
  budget: Budget | null;
  /** Account only: how many runs may drive at once. Null means the
   *  install's plan number, or no cap. */
  concurrency: number | null;
  notify: Notify | null;
  /** deploy_block: (FOL-58) — what a deploy refuses beyond its own checks.
   *  Null when unset, which reads as none. */
  deployBlock: DeployBlock | null;
  /** network_enforce: — true refuses a site off a step's network: list
   *  rather than only naming it. False when unset. */
  networkEnforce: boolean;
  /** telemetry: — where each run goes as an OpenTelemetry trace. Header
   *  values are as written: `${NAME}` for a vault secret, never its value. */
  telemetry: TelemetryConfig | null;
  /** owner: — who answers for every agent and flow here that names none. */
  owner: string | null;
  /** alerts: — the thresholds that tell notify:, as written. */
  alerts: Alerts | null;
  /** judge: — the model every grader here uses. */
  judge: Judge | null;
}

/** The AGENTS.md keys each scope's settings PATCH writes (`defaultsPatch`
 *  reads them all; a workspace's route takes this subset). The rest are
 *  written in the file itself. */
export const ACCOUNT_PATCHABLE = ["timezone", "budget", "concurrency", "notify", "deploy_block", "network_enforce", "telemetry", "owner", "alerts", "judge"] as const;
export const WORKSPACE_PATCHABLE = ["timezone", "budget", "notify", "network_enforce", "owner", "alerts", "judge"] as const;

export const DEPLOY_BLOCKS = ["none", "secrets", "security"] as const;
export type DeployBlock = (typeof DEPLOY_BLOCKS)[number];

export const NOTIFY_EVENTS = ["failed", "awaiting-approval", "completed"] as const;

export function defaultsOf(fm: Record<string, unknown>): Defaults {
  const n = fm.notify && typeof fm.notify === "object" ? (fm.notify as Record<string, unknown>) : null;
  return {
    timezone: typeof fm.timezone === "string" ? fm.timezone : null,
    budget: timedBudget(fm.budget),
    concurrency: Number.isInteger(Number(fm.concurrency)) && Number(fm.concurrency) > 0 ? Number(fm.concurrency) : null,
    notify: n
      ? {
          ...(typeof n.url === "string" && n.url ? { url: n.url } : {}),
          ...(typeof n.email === "string" && n.email ? { email: n.email } : {}),
          events: Array.isArray(n.events) ? n.events.filter((e): e is string => typeof e === "string") : ["failed", "awaiting-approval"],
        }
      : null,
    deployBlock: typeof fm.deploy_block === "string" && (DEPLOY_BLOCKS as readonly string[]).includes(fm.deploy_block) ? (fm.deploy_block as DeployBlock) : null,
    networkEnforce: fm.network_enforce === true,
    telemetry: parseTelemetry(fm.telemetry).config,
    owner: typeof fm.owner === "string" && fm.owner.trim() ? fm.owner.trim() : null,
    alerts: alertsOf(fm.alerts),
    judge: judgeOf(fm.judge),
  };
}

/** `alerts:` as written. `{}` is kept as `{}`: at a workspace it means "no
 *  alerts here", where an absent block means "the account's". */
function alertsOf(raw: unknown): Alerts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || parseAlerts(raw).problems.length) return null;
  const o = raw as Record<string, unknown>;
  const out: Alerts = {};
  for (const k of ALERT_KEYS) {
    const v = o[k];
    if (k === "new_host") {
      if (typeof v === "boolean") out.new_host = v;
    } else if (typeof v === "string" || typeof v === "number") (out as Record<string, string | number>)[k] = v;
  }
  return out;
}

function judgeOf(raw: unknown): Judge | null {
  const j = parseJudge(raw);
  if (j.problems.length || (!j.model && !j.effort)) return null;
  return { ...(j.model ? { model: j.model } : {}), ...(j.effort ? { effort: j.effort } : {}) };
}

/** The cap as the platform reads it: a bare number is per month; "per run"
 *  here is nobody's cap. */
function timedBudget(raw: unknown): Budget | null {
  const b = parseBudget(raw, "month");
  return b && b.period !== "run" ? b : null;
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A form's body as frontmatter keys. Only the keys present are touched;
 * null clears one. Returns the first thing wrong rather than a partial
 * write — a budget of "abc" must not clear the budget.
 */
export function defaultsPatch(body: Record<string, unknown>): { keys: Record<string, unknown | null> } | { error: string } {
  const keys: Record<string, unknown | null> = {};
  if ("timezone" in body) {
    const tz = body.timezone;
    if (tz === null || tz === "") keys.timezone = null;
    else if (typeof tz !== "string" || !validZone(tz)) return { error: `"${String(tz)}" is not an IANA time zone — Australia/Sydney, UTC, America/New_York` };
    else keys.timezone = tz;
  }
  if ("budget" in body) {
    // A number, "<number>/<day|week|month>", { usd, period }, or nothing.
    // Written back in the grammar the file reads — `60` alone for a month,
    // `60/day` otherwise — so the file stays something a person can read.
    const b = body.budget;
    const raw = b && typeof b === "object" ? `${(b as Budget).usd}/${(b as Budget).period}` : b;
    if (raw === null || raw === "" || raw === undefined) keys.budget = null;
    else {
      const problem = budgetProblem(raw, ["day", "week", "month"]);
      if (problem) return { error: problem };
      const parsed = timedBudget(raw);
      if (!parsed) keys.budget = null;
      else {
        const usd = Math.round(parsed.usd * 100) / 100;
        keys.budget = parsed.period === "month" ? usd : `${usd}/${parsed.period}`;
      }
    }
  }
  if ("concurrency" in body) {
    const c = body.concurrency;
    if (c === null || c === "") keys.concurrency = null;
    else {
      const n = typeof c === "number" ? c : Number(c);
      if (!Number.isInteger(n) || n < 1 || n > 64) return { error: "concurrency must be a whole number of runs from 1 to 64, or empty for the plan's" };
      keys.concurrency = n;
    }
  }
  if ("notify" in body) {
    const n = body.notify;
    if (n === null) keys.notify = null;
    else if (!n || typeof n !== "object") return { error: "notify must be { url?, email?, events }" };
    else {
      const o = n as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url.trim() : "";
      const email = typeof o.email === "string" ? o.email.trim() : "";
      if (!url && !email) return { error: "notify needs a webhook URL, an email, or both" };
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `"${email}" is not an email address` };
      if (url && !/^(https?:\/\/|\$\{[A-Z][A-Z0-9_]*\})/.test(url)) return { error: "the webhook URL must start with https:// or be a ${SECRET_NAME}" };
      const events = Array.isArray(o.events) ? o.events.filter((e): e is string => typeof e === "string" && (NOTIFY_EVENTS as readonly string[]).includes(e)) : [];
      if (events.length === 0) return { error: "pick at least one event to notify on" };
      keys.notify = { ...(url ? { url } : {}), ...(email ? { email } : {}), events };
    }
  }
  if ("deploy_block" in body) {
    const d = body.deploy_block;
    if (d === null || d === "") keys.deploy_block = null;
    else if (typeof d !== "string" || !(DEPLOY_BLOCKS as readonly string[]).includes(d)) return { error: `deploy_block is ${DEPLOY_BLOCKS.join(", ")} — not "${String(d)}"` };
    else keys.deploy_block = d;
  }
  if ("network_enforce" in body) {
    // Off is the key removed, so the file only ever says the one word that
    // changes something.
    const v = body.network_enforce;
    if (v === null || v === false) keys.network_enforce = null;
    else if (v === true) keys.network_enforce = true;
    else return { error: `network_enforce is true or false — not "${String(v)}"` };
  }
  if ("telemetry" in body) {
    // { otlp, headers } as AGENTS.md takes it, or null to stop sending.
    const t = body.telemetry;
    if (t === null) keys.telemetry = null;
    else {
      const { config, problems } = parseTelemetry(t);
      if (!config) return { error: problems[0] ?? "telemetry needs otlp: an https URL" };
      keys.telemetry = { otlp: config.endpoint, ...(Object.keys(config.headers).length ? { headers: config.headers } : {}) };
    }
  }
  if ("owner" in body) {
    const o = body.owner;
    if (o === null || o === "") keys.owner = null;
    else if (typeof o !== "string" || o.trim().length > 200) return { error: "owner is a person's email or name, up to 200 characters" };
    else keys.owner = o.trim();
  }
  if ("alerts" in body) {
    // What the form sends: only the thresholds set; empty or null clears.
    const a = body.alerts;
    if (a === null) keys.alerts = null;
    else if (!a || typeof a !== "object" || Array.isArray(a)) return { error: "alerts is a block of thresholds — failure_rate, min_runs, credits_day, run_minutes, stale_days, cost_spike, runs_per_hour, new_host" };
    else {
      // Blank fields are left out; `new_host: false` and an empty block are
      // kept — at a workspace `{}` is "no alerts here", null "the account's".
      const cleaned = Object.fromEntries(Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined));
      const { problems } = parseAlerts(cleaned);
      if (problems.length) return { error: problems[0]! };
      keys.alerts = cleaned;
    }
  }
  if ("judge" in body) {
    const j = body.judge;
    if (j === null) keys.judge = null;
    else {
      // An empty field in the form is "unset", not a value.
      const given = j && typeof j === "object" && !Array.isArray(j) ? Object.fromEntries(Object.entries(j as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined)) : j;
      const read = parseJudge(given);
      if (read.problems.length) return { error: read.problems[0]! };
      keys.judge = read.model || read.effort ? { ...(read.model ? { model: read.model } : {}), ...(read.effort ? { effort: read.effort } : {}) } : null;
    }
  }
  if (Object.keys(keys).length === 0) return { error: "nothing to change — send timezone, budget, concurrency, notify, deploy_block, network_enforce, telemetry, owner, alerts or judge" };
  return { keys };
}
