// The account Observe page's rules: what counts as the platform's fault,
// which desk is worst, what each day holds, and what is too few to say.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountTimezone,
  agentsToWatch,
  causeOf,
  causes,
  dayIn,
  deskHealth,
  kpis,
  median,
  perDay,
  toolsAcross,
  windows,
  DAY,
} from "../components/account-observe-model.ts";
import type { RunLite } from "../components/mission-model.ts";

const NOW = Date.parse("2026-09-30T01:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
let n = 0;
const run = (p: Partial<RunLite>): RunLite => ({
  workspace: "desk", id: `r${n++}`, what: "daily", outcome: "good", startedAt: iso(2), finishedAt: iso(1.9),
  headline: null, failure: null, steps: 3, done: 3, active: null, costUsd: 0.5, ...p,
});
const failed = (reason: string, p: Partial<RunLite> = {}) => run({ outcome: "failed", failure: { agent: "x", reason }, ...p });

test("causes: the platform's failures are named by what broke; the desk's by how it failed", () => {
  assert.equal(causeOf(failed("pod never became ready: timed out waiting for the condition"))?.kind, "platform");
  assert.equal(causeOf(failed("pod never became ready: timed out waiting for the condition"))?.platform, true);
  assert.equal(causeOf(failed("verify `matches: GOOD` → no match"))?.kind, "verify");
  assert.equal(causeOf(failed("step timed out after 900s"))?.kind, "timeout");
  assert.equal(causeOf(failed("TypeError: x is undefined"))?.kind, "error");
  assert.equal(causeOf(run({ outcome: "blocked" }))?.kind, "blocked");
  assert.equal(causeOf(run({ outcome: "bad" }))?.kind, "bad");
  assert.equal(causeOf(run({ outcome: "stopped" }))?.kind, "stopped");
  assert.equal(causeOf(run({ outcome: "good" })), null);
  assert.equal(causeOf(run({ outcome: "running", finishedAt: null })), null);
});

test("causes: grouped, platform first, each with every desk it hit and its newest run", () => {
  const rows = causes([
    failed("verify → no match", { workspace: "a" }),
    failed("verify → no match", { workspace: "b" }),
    failed("verify → no match", { workspace: "a" }),
    failed("ErrImagePull", { workspace: "c", startedAt: iso(5) }),
    failed("ErrImagePull", { workspace: "a", startedAt: iso(3), id: "newest-pull" }),
  ]);
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.count}`), ["platform:2", "verify:3"]);
  assert.deepEqual(rows[0].desks, ["a", "c"]);
  assert.equal(rows[0].newest.id, "newest-pull");
  assert.equal(rows[0].sample, "x: ErrImagePull");
});

test("windows: this window and the one before it, nothing older", () => {
  const { cur, prev } = windows([run({ startedAt: iso(10) }), run({ startedAt: iso(30) }), run({ startedAt: iso(60) })], NOW, 1);
  assert.equal(cur.length, 1);
  assert.equal(prev.length, 1);
});

test("kpis: the shared completion rate (FOL-54), platform and desk failures apart, a median needs five", () => {
  const cur = [
    run({}), run({}), run({ outcome: "quiet" }),
    run({ outcome: "blocked" }),
    failed("pod create failed: i/o timeout"),
    run({ outcome: "running", finishedAt: null }),
    run({ outcome: "stopped" }),
  ];
  const k = kpis(cur, [run({}), failed("boom")]);
  assert.equal(k.runs, 7);
  // finished = not live (the stopped one included, never "going"); the rate
  // is over completed + failed only — the stopped run left out, and the
  // BLOCKED one ran to the end (what it found is counted elsewhere): 4 of 5.
  assert.equal(k.finished, 6);
  assert.equal(k.rate, 4 / 5);
  assert.equal(k.prevRate, 0.5);
  assert.equal(k.platformFailures, 1);
  assert.equal(k.deskFailures, 1, "BLOCKED is the desk's; a person's stop is nobody's failure");
  assert.equal(median([1, 2, 3, 4]), null);
  assert.equal(median([5, 1, 3, 2, 4]), 3);
});

test("perDay: every calendar day in the viewer's zone, zero-filled, platform failures inside failed", () => {
  const tz = "Australia/Sydney";
  // 22:12Z on the 29th is the morning of the 30th in Sydney.
  const d = perDay([
    failed("ErrImagePull", { startedAt: "2026-09-29T22:12:00Z", costUsd: 0 }),
    run({ startedAt: "2026-09-29T22:30:00Z", costUsd: 1 }),
    run({ outcome: "bad", startedAt: "2026-09-28T03:00:00Z" }),
  ], NOW, 7, tz);
  assert.equal(d.length, 7);
  const today = d.find((b) => b.day === "2026-09-30")!;
  assert.deepEqual([today.good, today.failed, today.platform, today.spendUsd], [1, 1, 1, 1]);
  assert.equal(d.find((b) => b.day === "2026-09-28")!.attention, 1);
  assert.equal(dayIn("2026-09-29T22:12:00Z", "UTC"), "2026-09-29");
  assert.equal(dayIn("2026-09-29T22:12:00Z", "Not/AZone"), "2026-09-29");
});

test("accountTimezone: the zone most schedules use, UTC when none say", () => {
  assert.equal(accountTimezone(["Australia/Sydney", "UTC", "Australia/Sydney", null]), "Australia/Sydney");
  assert.equal(accountTimezone([null, undefined]), "UTC");
});

test("deskHealth: desk failures first, then a falling rate; platform failures counted apart; idle desks last", () => {
  const cur = [
    failed("verify → no match", { workspace: "broken", what: "posts" }),
    failed("verify → no match", { workspace: "broken", what: "posts" }),
    failed("ErrImagePull", { workspace: "unlucky" }),
    run({ workspace: "unlucky" }),
    run({ workspace: "slipping" }), run({ workspace: "slipping", outcome: "blocked", what: "radar" }),
  ];
  const prev = [run({ workspace: "slipping" })];
  const rows = deskHealth(["idle", "unlucky", "slipping", "broken"], cur, prev);
  assert.deepEqual(rows.map((r) => r.workspace), ["broken", "slipping", "unlucky", "idle"]);
  assert.deepEqual(rows[0].worst, { what: "posts", count: 2 });
  assert.equal(rows[2].platformFailures, 1);
  assert.equal(rows[2].deskFailures, 0);
  assert.equal(rows[1].prevRate, 1);
  assert.equal(rows[3].runs, 0);
});

test("agents and tools: the failing and retrying first; tools merged across desks by name", () => {
  const s = (p50: number | null) => ({ n: 5, p50, p95: p50, max: p50 });
  const agents = agentsToWatch([
    { workspace: "a", agents: [{ agent: "writer", steps: 10, failed: 0, retried: 0, costUsd: 9, seconds: s(1) }] },
    { workspace: "b", agents: [{ agent: "validator", steps: 4, failed: 2, retried: 1, costUsd: 1, seconds: s(2) }] },
  ]);
  assert.deepEqual(agents.map((a) => `${a.workspace}/${a.agent}`), ["b/validator", "a/writer"]);
  const tools = toolsAcross([
    { workspace: "a", tools: [{ name: "web", calls: 10, errors: 0, ms: s(null) }, { name: "crm", calls: 2, errors: 1, ms: s(300) }] },
    { workspace: "b", tools: [{ name: "crm", calls: 3, errors: 2, ms: s(900) }] },
  ]);
  assert.equal(tools[0].name, "crm");
  assert.deepEqual([tools[0].calls, tools[0].errors, tools[0].p95ms], [5, 3, 900]);
  assert.deepEqual(tools[0].workspaces, ["a", "b"]);
  assert.equal(tools[1].p95ms, null);
});

test("DAY is a day", () => assert.equal(DAY, 86_400_000));
