// The overviews' shared helpers: a flow's last run, the money alerts, and
// the formatting every surface agrees on. Pure; tests/overview.test.ts pins
// the rules. The pages read disk and hand these the results.

import type { RunRecord } from "@/lib/store";
import { creditsShort } from "@/components/money";

const display = (r: Pick<RunRecord, "status" | "stopRequested">) =>
  r.status === "failed" && r.stopRequested ? "stopped" : r.status;

/** Going, queued, or waiting on a person — the three states a "N live" badge
 *  counts, and the ones worth a link straight to the run page. `queued` is in
 *  here because a parked run (a `wait:` deadline, an approval) is queued on
 *  disk: it is live in the sense that matters, which is that it is not done. */
export const isLiveRun = (r: Pick<RunRecord, "status">) =>
  r.status === "running" || r.status === "queued" || r.status === "awaiting-approval";

/** The newest of them, which is the one a badge should open. */
export function liveRunOf<T extends Pick<RunRecord, "id" | "status" | "startedAt">>(runs: T[]): T | null {
  return runs.filter(isLiveRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

export interface LastRun {
  id: string;
  flow: string;
  status: string;
  headline: string | null;
  startedAt: string;
}

export function lastRunOf(runs: RunRecord[]): LastRun | null {
  const newest = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!newest) return null;
  return {
    id: newest.id,
    flow: newest.flow,
    status: display(newest),
    headline: newest.summary?.trim() || null,
    startedAt: newest.startedAt,
  };
}

export interface Alert {
  level: "error" | "warn" | "info";
  text: string;
  href: string;
}

export interface AlertInput {
  /** The run counts are optional: the account overview lists approvals and
   *  failures run by run in Needs attention and asks this only about money.
   *  Given, they come back as the summary lines they always were. */
  approvals?: number;
  failedInDay?: number;
  /** The wallet's own alert, when this install has billing
   *  (server/billing-notices.ts walletNotice); placed by severity with the rest. */
  wallet?: Alert | null;
  nearCap: { workspace: string; spent: number; budget: number; /** "$60/day" — the cap as written, with its period. */ label?: string }[];
  qs: string;
}

/** What deserves the top of the page, worst first. Empty means all clear. */
export function alertsFor(a: AlertInput): Alert[] {
  const q = a.qs ? `?${a.qs}` : "";
  const out: Alert[] = [];
  const approvals = a.approvals ?? 0;
  const failedInDay = a.failedInDay ?? 0;
  if (approvals > 0) {
    out.push({
      level: "warn",
      text: approvals === 1 ? "1 run is waiting for your approval" : `${approvals} runs are waiting for your approval`,
      href: `/dashboard/runs?status=awaiting-approval${a.qs ? `&${a.qs}` : ""}`,
    });
  }
  if (failedInDay > 0) {
    out.push({
      level: "error",
      text: failedInDay === 1 ? "1 run failed in the last 24 hours" : `${failedInDay} runs failed in the last 24 hours`,
      href: `/dashboard/runs?status=failed&since=today${a.qs ? `&${a.qs}` : ""}`,
    });
  }
  if (a.wallet) out.push(a.wallet);
  for (const c of a.nearCap) {
    out.push({
      level: c.spent >= c.budget ? "error" : "warn",
      text: `${c.workspace} is at ${creditsShort(c.spent)} of its ${creditsShort(c.budget)} budget${c.label ? ` (written as ${c.label})` : " this month"}`,
      href: `/dashboard/${c.workspace}/settings${q}`,
    });
  }
  const weight = { error: 0, warn: 1, info: 2 };
  return out.sort((x, y) => weight[x.level] - weight[y.level]);
}

export function fmtMoney(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function fmtAgo(ms: number): string {
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/** The page's clock, read once per render on the server. */
export const nowMs = () => Date.now();
