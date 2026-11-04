// What the Observe pages compute on the server, over HTTP for `foldrun
// observe` and `foldrun eval trends` (5 Nov 2026):
//   - GET /api/observe — the account page's analysis (server/account-observe.ts):
//     the window against the one before, why runs went wrong, desks, agents
//     and tools to watch; 7 days unasked; a scoped caller sees its own;
//   - GET /api/workspaces/<ws>/evals/trends — evals by change (core
//     evalTrends): latest run against the last one on a different commit.
//
//   node --import ./tests/register.mjs --test tests/observe-routes.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-observe-routes-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_HISTORY = "journal";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

for (const ws of ["mine", "other"]) {
  const dir = path.join(DATA, "acme/workspaces", ws);
  fs.mkdirSync(path.join(dir, "agents/writer"), { recursive: true });
  fs.mkdirSync(path.join(dir, "flows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
  fs.writeFileSync(path.join(dir, "agents/writer/agent.md"), "---\nname: writer\n---\n\nWrite.\n");
  fs.writeFileSync(path.join(dir, "flows/daily.md"), "---\nname: daily\ntimezone: Australia/Sydney\n---\n\n1. [[writer]] — Write.\n");
}

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const observeRoute = await import("../app/api/observe/route.ts");
const trendsRoute = await import("../app/api/workspaces/[workspace]/evals/trends/route.ts");

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
let n = 0;
const run = (ws: string, h: number, status: "completed" | "failed", error?: string) =>
  writeRun("acme", ws, {
    id: `run-${ws}-${n++}`,
    flow: "daily",
    status,
    startedAt: hoursAgo(h),
    finishedAt: hoursAgo(h - 0.1),
    summary: status === "completed" ? "GOOD — done" : "",
    steps: [
      {
        agent: "writer", instruction: "x", group: 1, optional: false, status, result: status === "completed" ? "GOOD — done" : null, costUsd: 0.1,
        events: error ? [{ type: "error", text: error, at: hoursAgo(h - 0.1) }] : [],
      },
    ],
  } as never);

// This week in mine: two good, one desk failure, one platform failure.
run("mine", 2, "completed");
run("mine", 3, "completed");
run("mine", 4, "failed", "TypeError: x is undefined");
run("mine", 5, "failed", "pod never became ready: timed out waiting for the condition");
// The week before in mine: all good.
for (const h of [8 * 24, 9 * 24, 10 * 24]) run("mine", h, "completed");
// other, this week: a failure a scoped key must never see.
run("other", 6, "failed", "secret-desk-only reason");

const hist = (ws: string, lines: object[]) => {
  const dir = path.join(DATA, "acme/workspaces", ws, "evals/.results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "history.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
};
hist("mine", [
  { eval: "quality", at: "2026-11-01T00:00:00Z", commit: "aaaaaaa1", passed: 4, failed: 0, costUsd: 0.1 },
  { eval: "quality", at: "2026-11-02T00:00:00Z", commit: "bbbbbbb2", passed: 3, failed: 1, costUsd: 0.1 },
  { eval: "quality", at: "2026-11-03T00:00:00Z", commit: "bbbbbbb2", passed: 2, failed: 2, costUsd: 0.1 },
  { eval: "tone", at: "2026-11-03T00:00:00Z", commit: "bbbbbbb2", passed: 2, failed: 0, costUsd: 0.1 },
]);

const { key: every } = await createApiKey("acme", "all", "admin@acme.test", undefined, "viewer");
const { key: oneWs } = await createApiKey("acme", "one desk", "desk@acme.test", undefined, "viewer", ["mine"]);
const call = (key: string | null, url: string) => new NextRequest(`http://x${url}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const ws = (workspace: string) => ({ params: Promise.resolve({ workspace }) });

type Obs = {
  days: number;
  timezone: string;
  previous: { runs: number };
  kpis: { runs: number; rate: number | null; prevRate: number | null; deskFailures: number; platformFailures: number };
  causes: { kind: string; platform: boolean; count: number; desks: string[]; newest: { workspace: string; id: string } }[];
  desks: { workspace: string; runs: number; deskFailures: number; platformFailures: number; lastBad: { id: string } | null }[];
  agents: { workspace: string; agent: string; steps: number; failed: number }[];
  tools: unknown[];
  daily: { day: string }[];
};

test("GET /api/observe: the window against the one before, why runs went wrong, desks and agents — 7 days unasked", async () => {
  const res = await observeRoute.GET(call(every, "/api/observe"));
  assert.equal(res.status, 200, await res.clone().text());
  const o = (await res.json()) as Obs;
  assert.equal(o.days, 7);
  assert.equal(o.timezone, "Australia/Sydney");
  assert.equal(o.kpis.runs, 5);
  assert.equal(o.previous.runs, 3);
  assert.equal(o.kpis.prevRate, 1);
  assert.equal(o.kpis.rate, 2 / 5);
  assert.equal(o.kpis.platformFailures, 1);
  assert.equal(o.kpis.deskFailures, 2);
  // The platform's cause first, then the desks' by count.
  assert.equal(o.causes[0].kind, "platform");
  assert.equal(o.causes[0].platform, true);
  const error = o.causes.find((c) => c.kind === "error")!;
  assert.equal(error.count, 2);
  assert.deepEqual(error.desks, ["mine", "other"]);
  assert.deepEqual(Object.keys(o.causes[0].newest).sort(), ["failure", "finishedAt", "id", "outcome", "startedAt", "what", "workspace"]);
  assert.deepEqual(o.desks.map((d) => d.workspace).sort(), ["mine", "other"]);
  const mine = o.desks.find((d) => d.workspace === "mine")!;
  assert.equal(mine.runs, 4);
  assert.equal(mine.deskFailures, 1);
  assert.equal(mine.platformFailures, 1);
  assert.ok(mine.lastBad?.id);
  assert.ok(o.agents.some((a) => a.workspace === "mine" && a.agent === "writer" && a.failed === 2));
  assert.ok(o.daily.length >= 7);
});

test("GET /api/observe?days=1 narrows the window, and the window before it to one day", async () => {
  const o = (await (await observeRoute.GET(call(every, "/api/observe?days=1"))).json()) as Obs;
  assert.equal(o.days, 1);
  assert.equal(o.kpis.runs, 5);
  assert.equal(o.previous.runs, 0);
  assert.equal(o.kpis.prevRate, null);
});

test("GET /api/observe: a key scoped to one workspace sees that one, nothing of the others", async () => {
  const res = await observeRoute.GET(call(oneWs, "/api/observe"));
  assert.equal(res.status, 200);
  const text = await res.text();
  // ("other" is also a day bucket's field, so the workspace is looked for by name.)
  assert.doesNotMatch(text, /"workspace":"other"|"other"\]|\["other"|secret-desk-only/);
  const o = JSON.parse(text) as Obs;
  assert.equal(o.kpis.runs, 4);
  assert.deepEqual(o.desks.map((d) => d.workspace), ["mine"]);
  assert.ok(o.causes.every((c) => c.desks.every((d) => d === "mine")));
});

test("GET /api/observe without a key is refused", async () => {
  assert.equal((await observeRoute.GET(call(null, "/api/observe"))).status, 401);
});

test("GET …/evals/trends: the latest run against the last on a different commit, the drop first", async () => {
  const res = await trendsRoute.GET(call(every, "/api/workspaces/mine/evals/trends"), ws("mine"));
  assert.equal(res.status, 200, await res.clone().text());
  const t = (await res.json()) as { workspace: string; trends: { eval: string; latest: { commit: string; passed: number }; previous: { commit: string; passed: number } | null; delta: number | null }[] };
  assert.equal(t.workspace, "mine");
  assert.deepEqual(t.trends.map((x) => x.eval), ["quality", "tone"]);
  const q = t.trends[0];
  assert.equal(q.latest.passed, 2);
  assert.equal(q.latest.commit, "bbbbbbb2");
  // Not the run before on the same commit: the one on the commit before.
  assert.equal(q.previous?.commit, "aaaaaaa1");
  assert.equal(q.delta, -2);
  assert.equal(t.trends[1].previous, null);
  assert.equal(t.trends[1].delta, null);
});

test("GET …/evals/trends: an empty history is an empty list; no workspace is a 404; another workspace is refused a scoped key", async () => {
  const empty = (await (await trendsRoute.GET(call(every, "/api/workspaces/other/evals/trends"), ws("other"))).json()) as { trends: unknown[] };
  assert.deepEqual(empty.trends, []);
  assert.equal((await trendsRoute.GET(call(every, "/api/workspaces/nope/evals/trends"), ws("nope"))).status, 404);
  assert.equal((await trendsRoute.GET(call(oneWs, "/api/workspaces/other/evals/trends"), ws("other"))).status, 403);
  assert.equal((await trendsRoute.GET(call(oneWs, "/api/workspaces/mine/evals/trends"), ws("mine"))).status, 200);
});
