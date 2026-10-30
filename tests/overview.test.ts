// The overviews' shared helpers: a flow's last run, the money alerts, the
// words — from run records alone.

import test from "node:test";
import assert from "node:assert/strict";
import { alertsFor, lastRunOf, fmtMoney } from "../components/overview-model.ts";
import type { RunRecord } from "../../foldrun-core/src/store.ts";

const NOW = Date.parse("2026-09-04T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const run = (over: Partial<RunRecord> & { workspace?: string }): RunRecord & { workspace: string } => ({
  id: "r", flow: "weekly", status: "completed", startedAt: at(0), finishedAt: null, steps: [], workspace: "ws", ...over,
});

test("the last run reads as stopped, with a trimmed headline", () => {
  const last = lastRunOf([run({ status: "failed", stopRequested: true, summary: " done \n" })]);
  assert.equal(last?.status, "stopped");
  assert.equal(last?.headline, "done");
});

test("alerts: worst first, none means all clear, and the wallet's alert takes its place by severity", () => {
  const none = alertsFor({ approvals: 0, failedInDay: 0, nearCap: [], qs: "" });
  assert.deepEqual(none, []);
  const wallet = { level: "warn" as const, text: "Wallet below 20 credits", href: "/dashboard/wallet?tenant=acme" };
  const some = alertsFor({
    approvals: 2, failedInDay: 1, wallet,
    nearCap: [{ workspace: "leads", spent: 95, budget: 100 }], qs: "tenant=acme",
  });
  assert.deepEqual(some.map((a) => a.level), ["error", "warn", "warn", "warn"]);
  assert.ok(some[0].text.includes("failed"));
  assert.ok(some.every((a) => a.href.includes("tenant=acme")));
  assert.ok(some.includes(wallet));
  // Without billing there is no wallet alert: only what the engine knows.
  assert.deepEqual(alertsFor({ approvals: 0, failedInDay: 0, wallet: null, nearCap: [], qs: "" }), []);
});

test("alerts: asked about money only, the run lines stay out", () => {
  const money = alertsFor({ wallet: { level: "error", text: "The wallet is empty — scheduled runs will not start", href: "/dashboard/wallet" }, nearCap: [], qs: "" });
  assert.equal(money.length, 1);
  assert.ok(money[0].href.startsWith("/dashboard/wallet"));
});

test("the words", () => {
  assert.equal(fmtMoney(0), "$0");
  assert.equal(fmtMoney(12.345), "$12.35");
});
