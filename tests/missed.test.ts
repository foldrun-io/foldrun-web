// FOL-72 step 7: a scheduled fire that started no run is a missed schedule;
// a fire covered by a run (on time, late within the window, or skipped
// because one was going) is not; fires from before the flow last changed
// are not counted.
//
//   node --import ./tests/register.mjs --test tests/missed.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-missed-"));
process.env.FOLDRUN_DATA = root;
const { missedFires } = await import("../server/missed.ts");

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const DAY = 86_400_000;
const ws = path.join(root, "acme", "workspaces", "desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents", "writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(ws, "agents", "writer", "agent.md"), "---\nname: writer\ndescription: d\n---\n\nWrite.\n");
const flow = path.join(ws, "flows", "daily.md");
fs.writeFileSync(flow, "---\ntrigger: schedule\nschedule: \"0 9 * * *\"\ntimezone: UTC\n---\n\n1. [[writer]] — Write.\n");
// Changed four days ago: fires on the 16th, 17th, 18th and 19th count.
fs.utimesSync(flow, new Date(NOW - 3.5 * DAY), new Date(NOW - 3.5 * DAY));

const lite = (startedAt: string, finishedAt: string | null = null) => ({
  workspace: "desk", id: `r-${startedAt}`, what: "daily", outcome: "good" as const, startedAt, finishedAt,
  headline: null, failure: null, steps: 1, done: 1, active: null, costUsd: 0,
});

test("only the fire no run covers is missed", () => {
  const runs = [
    lite("2026-10-16T09:00:20.000Z", "2026-10-16T09:05:00.000Z"), // on time
    lite("2026-10-17T09:20:00.000Z", "2026-10-17T09:30:00.000Z"), // late, within 30 min
    lite("2026-10-19T08:50:00.000Z", "2026-10-19T09:40:00.000Z"), // already going at 09:00
  ];
  const missed = missedFires("acme", ["desk"], runs, NOW);
  assert.deepEqual(missed.map((m) => m.startedAt), ["2026-10-18T09:00:00.000Z"]);
  assert.equal(missed[0]!.missed, true);
  assert.match(missed[0]!.headline!, /^due Sun 09:00 \(UTC\), no run started$/);
});

test("a fire inside a pause its people set is not missed — paused now, or paused then and resumed", () => {
  const ran = [lite("2026-10-16T09:00:20.000Z", "2026-10-16T09:05:00.000Z"), lite("2026-10-17T09:00:20.000Z", "2026-10-17T09:05:00.000Z")];
  // Paused the 17th at noon, resumed the 18th at 10:00: the 18th's 09:00 was held, the 19th's was missed.
  const window = () => [{ from: Date.parse("2026-10-17T12:00:00Z"), to: Date.parse("2026-10-18T10:00:00Z") }];
  assert.deepEqual(missedFires("acme", ["desk"], ran, NOW, window).map((m) => m.startedAt), ["2026-10-19T09:00:00.000Z"]);
  // Still paused: nothing since is missed.
  const open = () => [{ from: Date.parse("2026-10-17T12:00:00Z"), to: null }];
  assert.deepEqual(missedFires("acme", ["desk"], ran, NOW, open), []);
});

test("a fire less than the late window ago is not missed yet; a manual flow never is", () => {
  const justNow = Date.parse("2026-10-19T09:10:00.000Z");
  const runs = [lite("2026-10-16T09:00:20.000Z"), lite("2026-10-17T09:00:20.000Z"), lite("2026-10-18T09:00:20.000Z")];
  assert.deepEqual(missedFires("acme", ["desk"], runs, justNow), []);
  fs.writeFileSync(flow, "---\ntrigger: manual\n---\n\n1. [[writer]] — Write.\n");
  assert.deepEqual(missedFires("acme", ["desk"], [], NOW), []);
});
