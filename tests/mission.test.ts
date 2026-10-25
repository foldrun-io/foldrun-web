// Mission control, the run page's outcome and the trace's sorting: the
// rules the new observability surfaces stand on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOf, needsAttention, isSuccess } from "../components/outcome-model.ts";
import { attention, needsList, heartbeats, nowBoard, fmtSpan, flowStrips, platformCause, spendWithin, STUCK_MS, DAY_MS, type RunLite } from "../components/mission-model.ts";
import { deskRows, filterDesks } from "../components/desks-model.ts";
import { classify, splitTool, counts } from "../components/trace-model.ts";
import { runHref } from "../components/run-href.ts";

const NOW = Date.parse("2026-09-29T02:00:00Z");
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
const run = (p: Partial<RunLite>): RunLite => ({
  workspace: "desk", id: `r${Math.random()}`, what: "posts", outcome: "good", startedAt: iso(30), finishedAt: iso(20),
  headline: null, failure: null, steps: 3, done: 3, active: null, costUsd: 0.1, ...p,
});

test("an outcome reads status and verdict together — a BLOCKED completion is not green", () => {
  assert.equal(outcomeOf("completed", "BLOCKED"), "blocked");
  assert.equal(outcomeOf("completed", "GOOD"), "good");
  assert.equal(outcomeOf("completed", null), "done");
  assert.equal(outcomeOf("failed", "GOOD"), "failed");
  assert.equal(outcomeOf("stopped", null), "stopped");
  assert.equal(outcomeOf("awaiting-approval", null), "waiting");
  assert.ok(needsAttention("blocked") && needsAttention("bad") && needsAttention("failed"));
  assert.ok(isSuccess("quiet") && !isSuccess("blocked"));
});

test("a run's link is its own page, carrying the account only when it is not the default", () => {
  assert.equal(runHref("reddit-desk", "run-1"), "/dashboard/reddit-desk/runs/run-1");
  assert.equal(runHref("reddit-desk", "run-1", "default"), "/dashboard/reddit-desk/runs/run-1");
  assert.equal(runHref("a b", "run-1", "matt"), "/dashboard/a%20b/runs/run-1?tenant=matt");
});

test("now: what is live, longest first, and a run past an hour is flagged stuck", () => {
  const b = nowBoard([
    run({ id: "a", outcome: "running", startedAt: iso(5) }),
    run({ id: "b", outcome: "running", startedAt: iso(90) }),
    run({ id: "c", outcome: "good" }),
    run({ id: "d", outcome: "waiting", startedAt: iso(10) }),
  ], NOW);
  assert.deepEqual(b.map((x) => x.id), ["b", "d", "a"]);
  assert.equal(b[0].stuck, true);
  assert.equal(b[2].stuck, false);
  assert.ok(STUCK_MS === 3_600_000);
});

test("attention: the newest bad run per desk and flow, counted, and recoveries dropped", () => {
  const list = attention([
    run({ id: "f1", what: "posts", outcome: "failed", startedAt: iso(120), failure: { agent: "writer", reason: "timeout" } }),
    run({ id: "f2", what: "posts", outcome: "failed", startedAt: iso(60), failure: { agent: "writer", reason: "timeout again" } }),
    run({ id: "ok", what: "digest", outcome: "failed", startedAt: iso(200) }),
    run({ id: "ok2", what: "digest", outcome: "good", startedAt: iso(100) }),
    run({ id: "old", what: "ancient", outcome: "failed", startedAt: iso(60 * 30) }),
    run({ id: "w", what: "approve", outcome: "waiting", startedAt: iso(15), active: { index: 4, agent: "publisher" } }),
    run({ id: "b", workspace: "other", what: "posts", outcome: "blocked", startedAt: iso(10), headline: "BLOCKED — balance empty" }),
  ], NOW);
  assert.deepEqual(list.map((a) => `${a.kind}:${a.run?.id}`), ["waiting:w", "failed:f2", "blocked:b"]);
  assert.equal(list[1].count, 2);
  assert.equal(list[1].reason, "writer: timeout again");
  assert.match(list[0].reason, /step 4 · publisher/);
  assert.equal(list[2].reason, "BLOCKED — balance empty");
});

test("heartbeats: the last n runs oldest first, success over finished runs, live and broken desks first", () => {
  const runs = [
    ...Array.from({ length: 30 }, (_, i) => run({ workspace: "busy", id: `b${i}`, startedAt: iso(300 - i), outcome: i % 5 === 0 ? "failed" : "good" })),
    run({ workspace: "broken", id: "x", startedAt: iso(500), outcome: "bad" }),
    run({ workspace: "live", id: "l", startedAt: iso(1), outcome: "running" }),
  ];
  const beats = heartbeats(["busy", "broken", "live", "empty"], runs, NOW, 24);
  assert.deepEqual(beats.map((h) => h.workspace), ["live", "broken", "busy", "empty"]);
  const busy = beats.find((h) => h.workspace === "busy")!;
  assert.equal(busy.cells.length, 24);
  assert.equal(busy.cells[0].id, "b6");
  assert.equal(busy.last!.id, "b29");
  assert.equal(beats.find((h) => h.workspace === "live")!.rate, null, "a live run is not a success or a failure yet");
  assert.equal(beats.find((h) => h.workspace === "empty")!.last, null);
});

test("spans read compactly", () => {
  assert.equal(fmtSpan(42_000), "42s");
  assert.equal(fmtSpan(5 * 60_000), "5m");
  assert.equal(fmtSpan(125 * 60_000), "2h 5m");
  assert.equal(fmtSpan(3 * 24 * 60 * 60_000), "3d");
  // A start stamped ahead of the page's clock (another machine's clock, a
  // record from a skewed host) read "-14351s" in the desks table's Latest.
  assert.equal(fmtSpan(-14_351_000), "0s");
});

test("the trace sorts the runner's one stream into what a person reads it for", () => {
  assert.equal(classify({ type: "text", text: "The post is live." }).kind, "agent");
  const t = classify({ type: "tool", text: "mcp__foldrun_scripts__web", durationMs: 1200 });
  assert.equal(t.kind, "tool");
  assert.equal(t.tool!.name, "web");
  assert.equal(classify({ type: "tool", text: "Read", err: true }).kind, "error");
  const s = classify({ type: "info", text: "script: web(action=browse, url=https://x.com, mode=text) → exit 0 (18071ms, sandbox)" });
  assert.deepEqual([s.kind, s.tool!.name, s.tool!.args, s.durationMs], ["tool", "web", "action=browse, url=https://x.com, mode=text", 18071]);
  assert.equal(classify({ type: "info", text: "script: post_ledger(x=1) → exit 1 (12ms, sandbox)" }).kind, "error");
  const ok = classify({ type: "info", text: "verify `matches: GOOD` → matched" });
  assert.deepEqual([ok.kind, ok.ok], ["verify", true]);
  const bad = classify({ type: "info", text: "verify `file: out.md` → failed: no such file" });
  assert.deepEqual([bad.kind, bad.ok], ["verify", false]);
  assert.equal(classify({ type: "info", text: "egress: POST api.anthropic.com/v1/messages → 200 × 4" }).kind, "system");
  assert.equal(classify({ type: "error", text: "timed out" }).kind, "error");
  assert.deepEqual(splitTool("Bash"), { name: "Bash", args: "" });
  const c = counts([ok, bad, s]);
  assert.equal(c.verify, 2);
  assert.equal(c.all, 3);
});

test("platform failures: named by what broke, not by the desk it happened to", () => {
  // The words the platform actually wrote on 2026-09-30.
  assert.equal(platformCause("pod never became ready:\nerror: timed out waiting for the condition on pods/foldrun-run-mun8etbs-ly4w")?.key, "sandbox");
  assert.equal(platformCause("Failed to pull image \"localhost:5000/foldrun-runner:a06658d80603\": not found")?.key, "sandbox");
  assert.equal(platformCause("pod create failed:\nerror: error validating \"STDIN\": failed to download openapi: Get \"https://10.43.0.1:443/openapi/v2\": dial tcp 10.43.0.1:443: i/o timeout")?.key, "sandbox");
  assert.equal(platformCause("401 from the model: OAuth token has expired")?.key, "model-auth");
  assert.equal(platformCause("You have reached your weekly limit")?.key, "model-cap");
  // A desk's own 401 (its CRM, a site) is the desk's to fix.
  assert.equal(platformCause("crm returned 401 unauthorized"), null);
  assert.equal(platformCause("writer: no sources found"), null);
  assert.equal(platformCause(null), null);
});

test("attention: platform failures across desks become one item, listed first, desk failures stay apart", () => {
  const pod = "pod never became ready: timed out waiting for the condition";
  const list = attention([
    run({ id: "m", workspace: "medium-desk", what: "articles", outcome: "failed", startedAt: iso(30), failure: { agent: "login-checker", reason: pod } }),
    run({ id: "e", workspace: "expert-witness-desk", what: "daily", outcome: "failed", startedAt: iso(29), failure: { agent: "login-checker", reason: pod } }),
    run({ id: "own", workspace: "blog-desk", what: "posts", outcome: "failed", startedAt: iso(20), failure: { agent: "writer", reason: "no sources" } }),
    run({ id: "w", what: "approve", outcome: "waiting", startedAt: iso(15) }),
  ], NOW);
  assert.deepEqual(list.map((a) => a.kind), ["platform", "waiting", "failed"]);
  const p = list[0];
  assert.equal(p.count, 2);
  assert.deepEqual(p.desks, ["expert-witness-desk", "medium-desk"]);
  assert.equal(p.run?.id, "e");
  assert.match(p.reason, /runner image/);
  assert.equal(list[2]!.run?.id, "own");
});

test("attention: a flow that ran fine after the platform broke is not listed", () => {
  const list = attention([
    run({ id: "bad", what: "articles", outcome: "failed", startedAt: iso(60), failure: { agent: "x", reason: "ErrImagePull" } }),
    run({ id: "rerun", what: "articles", outcome: "good", startedAt: iso(10) }),
  ], NOW);
  assert.deepEqual(list, []);
});

test("flow strips: keyed by flow, other flows and agent runs kept out", () => {
  const strips = flowStrips(["daily", "weekly"], [
    run({ id: "a", what: "daily", startedAt: iso(50) }),
    run({ id: "b", what: "daily", startedAt: iso(40), outcome: "failed" }),
    run({ id: "c", what: "agent: writer", startedAt: iso(30) }),
  ], NOW, 12);
  assert.deepEqual(strips.get("daily")?.cells.map((r) => r.id), ["a", "b"]);
  assert.equal(strips.get("daily")?.last?.id, "b");
  assert.equal(strips.get("weekly")?.cells.length, 0);
  assert.equal(strips.has("agent: writer"), false);
});

test("spend: only runs started inside the window", () => {
  const runs = [run({ costUsd: 1, startedAt: iso(60) }), run({ costUsd: 2, startedAt: iso(60 * 30) })];
  assert.equal(spendWithin(runs, NOW, DAY_MS), 1);
  assert.equal(spendWithin(runs, NOW, 7 * DAY_MS), 3);
});

test("desks: one row per workspace in heartbeat order, with the next fire and the live run to open", () => {
  const runs = [
    run({ id: "l1", workspace: "live", outcome: "running", startedAt: iso(5) }),
    run({ id: "q1", workspace: "quiet", startedAt: iso(300) }),
  ];
  const beats = heartbeats(["quiet", "live", "never"], runs, NOW, 20);
  const w = (name: string) => ({ name, description: `${name} desk`, agents: 2, flows: 1 });
  const rows = deskRows([w("quiet"), w("live"), w("never")], beats, [
    { workspace: "quiet", flow: "daily", at: iso(-60) },
    { workspace: "quiet", flow: "weekly", at: iso(-600) },
  ]);
  assert.deepEqual(rows.map((d) => d.name), ["live", "quiet", "never"]);
  assert.equal(rows[0].liveRunId, "l1");
  assert.deepEqual(rows[1].next, { flow: "daily", at: iso(-60) });
  assert.equal(rows[2].next, null);
  assert.deepEqual(filterDesks(rows, "", "name").map((d) => d.name), ["live", "never", "quiet"]);
  assert.deepEqual(filterDesks(rows, "daily", "activity").map((d) => d.name), ["quiet"]);
});

test("trace: a sub-agent's call carries its name; the parent's does not", () => {
  const sub = classify({ type: "tool", text: "Read(a.md)", subagent: "researcher" });
  assert.equal(sub.kind, "tool");
  assert.equal(sub.subagent, "researcher");
  assert.equal(sub.tool?.name, "Read");
  assert.equal(classify({ type: "tool", text: "Read(a.md)" }).subagent, undefined);
  assert.equal(classify({ type: "info", text: "delegating to researcher: read two files", subagent: "researcher" }).subagent, "researcher");
});

test("FOL-54: a desk's strip carries the counts Home shows, from the shared tally", () => {
  const runs = [run({ outcome: "good" }), run({ outcome: "failed" }), run({ outcome: "blocked" }), run({ outcome: "stopped" }), run({ outcome: "quiet" })];
  const [h] = heartbeats(["desk"], runs, NOW);
  assert.deepEqual({ completed: h.tally.completed, finished: h.tally.finished, failed: h.tally.failed, blocked: h.tally.blocked, stopped: h.tally.stopped }, { completed: 3, finished: 4, failed: 1, blocked: 1, stopped: 1 });
  assert.equal(h.rate, 3 / 4);
});

test("FOL-54 step 3: Home keeps a failure from two days ago though a later run was fine — until it is resolved", async () => {
  const { foldIssues, issueKeyOf, applyIssueAction } = await import("../../foldrun-core/src/issues.ts");
  const old = run({ id: "old", outcome: "failed", startedAt: iso(48 * 60), finishedAt: iso(48 * 60 - 1), failure: { agent: "writer", reason: "exit 1" } });
  const fine = run({ id: "fine", outcome: "good", startedAt: iso(10) });
  const waiting = run({ id: "w", outcome: "waiting", startedAt: iso(5), finishedAt: null });
  const runs = [old, fine, waiting];
  assert.equal(attention(runs, NOW).filter((a) => a.kind === "failed").length, 0, "the old list dropped it");
  const items = needsList(runs, foldIssues(runs, {}, NOW), NOW);
  const failed = items.find((a) => a.kind === "failed")!;
  assert.ok(failed.issue && failed.fineMs !== null && failed.fineMs !== undefined, "listed, saying it has been fine since");
  assert.ok(items.some((a) => a.kind === "waiting"));
  const id = issueKeyOf(old)!.id;
  const resolved = { [id]: applyIssueAction(null, { at: new Date(NOW).toISOString(), by: "a@x", action: "resolve" }, NOW) };
  assert.equal(needsList(runs, foldIssues(runs, resolved, NOW), NOW).filter((a) => a.kind === "failed").length, 0);
});
