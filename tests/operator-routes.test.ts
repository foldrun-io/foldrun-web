// Answering an agent's question, and writing into a running step: who may,
// what shape, and the refusals.
//
//   node --import ./tests/register.mjs --test tests/operator-routes.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-operator-routes-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const answerRoute = await import("../app/api/workspaces/[workspace]/runs/[runId]/answer/route.ts");
const messageRoute = await import("../app/api/workspaces/[workspace]/runs/[runId]/message/route.ts");
const approvalsRoute = await import("../app/api/approvals/route.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const { closeQuestion, postQuestion, pendingMessages, resetOperatorMemory } = await import("../../foldrun-platform/src/operator-store.ts");

const ws = path.join(process.env.FOLDRUN_DATA!, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");

const run = (id: string, status: "running" | "completed") =>
  writeRun("acme", "desk", {
    id,
    flow: "daily",
    status,
    startedAt: new Date().toISOString(),
    finishedAt: status === "completed" ? new Date().toISOString() : null,
    steps: [{ agent: "writer", instruction: "draft", group: 1, optional: false, status: status === "running" ? "running" : "completed", events: [], result: null, costUsd: 0 }],
  });

const { key: editor } = await createApiKey("acme", "ci", "ed@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey("acme", "look", "vi@acme.test", undefined, "viewer");
const ctx = (runId: string) => ({ params: Promise.resolve({ workspace: "desk", runId }) });
const req = (url: string, key: string, body: unknown) =>
  new NextRequest(`http://x${url}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("answer: an editor answers once; a second answer is 409 with the one that stands; a viewer is refused", async () => {
  resetOperatorMemory();
  run("run-q", "running");
  const q = await postQuestion("acme", "run-q", { question: "9 or 10?", options: ["9", "10"] });
  const denied = await answerRoute.POST(req("/api/workspaces/desk/runs/run-q/answer", viewer, { question: q.id, answer: "9" }), ctx("run-q"));
  assert.equal(denied.status, 403);
  const ok = await answerRoute.POST(req("/api/workspaces/desk/runs/run-q/answer", editor, { question: q.id, answer: "10" }), ctx("run-q"));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.answer, "10");
  assert.match(String(body.by), /key|ed@acme/, "attributed to the caller");
  const again = await answerRoute.POST(req("/api/workspaces/desk/runs/run-q/answer", editor, { question: q.id, answer: "9" }), ctx("run-q"));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).answer, "10");
});

test("answer: a question of another run, or none, is 404; a bad body is 400", async () => {
  resetOperatorMemory();
  run("run-a", "running");
  run("run-b", "running");
  const q = await postQuestion("acme", "run-a", { question: "which?" });
  const wrongRun = await answerRoute.POST(req("/api/workspaces/desk/runs/run-b/answer", editor, { question: q.id, answer: "x" }), ctx("run-b"));
  assert.equal(wrongRun.status, 404);
  const empty = await answerRoute.POST(req("/api/workspaces/desk/runs/run-a/answer", editor, { question: q.id }), ctx("run-a"));
  assert.equal(empty.status, 400);
  const noRun = await answerRoute.POST(req("/api/workspaces/desk/runs/nope/answer", editor, { question: q.id, answer: "x" }), ctx("nope"));
  assert.equal(noRun.status, 404);
});

test("message: a running run takes it into its inbox; a finished one is 409; too long is 413", async () => {
  resetOperatorMemory();
  run("run-live", "running");
  run("run-done", "completed");
  const ok = await messageRoute.POST(req("/api/workspaces/desk/runs/run-live/message", editor, { text: "use 2025 figures" }), ctx("run-live"));
  assert.equal(ok.status, 200);
  assert.equal((await pendingMessages("acme", "run-live"))[0].text, "use 2025 figures");
  const done = await messageRoute.POST(req("/api/workspaces/desk/runs/run-done/message", editor, { text: "hi" }), ctx("run-done"));
  assert.equal(done.status, 409);
  const long = await messageRoute.POST(req("/api/workspaces/desk/runs/run-live/message", editor, { text: "x".repeat(5000) }), ctx("run-live"));
  assert.equal(long.status, 413);
  const denied = await messageRoute.POST(req("/api/workspaces/desk/runs/run-live/message", viewer, { text: "hi" }), ctx("run-live"));
  assert.equal(denied.status, 403);
});

test("approvals lists the open questions of running runs, not of finished ones", async () => {
  resetOperatorMemory();
  run("run-open", "running");
  run("run-over", "completed");
  await postQuestion("acme", "run-open", { question: "go?", options: ["yes", "no"] });
  await postQuestion("acme", "run-over", { question: "stale?" });
  const res = await approvalsRoute.GET(new NextRequest("http://x/api/approvals", { headers: { authorization: `Bearer ${editor}` } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.questions.length, 1);
  assert.equal(body.questions[0].kind, "question");
  assert.equal(body.questions[0].runId, "run-open");
  assert.equal(body.questions[0].agent, "writer");
  assert.deepEqual(body.questions[0].options, ["yes", "no"]);
});

const step = (agent: string, status: "running" | "completed", extra: Record<string, unknown> = {}) => ({
  agent, instruction: "work", group: 1, optional: false, status, events: [], result: null, costUsd: 0, ...extra,
});
const runWith = (id: string, steps: ReturnType<typeof step>[]) =>
  writeRun("acme", "desk", { id, flow: "daily", status: "running", startedAt: new Date().toISOString(), finishedAt: null, steps } as never);

test("message: names its step; with one running step that one; with two and none named, 400 listing them", async () => {
  resetOperatorMemory();
  runWith("run-par", [step("writer", "running"), step("checker", "running"), step("done", "completed")]);
  const none = await messageRoute.POST(req("/api/workspaces/desk/runs/run-par/message", editor, { text: "hi" }), ctx("run-par"));
  assert.equal(none.status, 400);
  const body = await none.json();
  assert.deepEqual(body.running.map((r: { step: number }) => r.step), [0, 1]);
  const ok = await messageRoute.POST(req("/api/workspaces/desk/runs/run-par/message", editor, { text: "for the checker", step: 1 }), ctx("run-par"));
  assert.equal(ok.status, 200);
  assert.equal((await pendingMessages("acme", "run-par", 1))[0].text, "for the checker");
  assert.deepEqual(await pendingMessages("acme", "run-par", 0), [], "the other step's inbox is untouched");
  const ended = await messageRoute.POST(req("/api/workspaces/desk/runs/run-par/message", editor, { text: "x", step: 2 }), ctx("run-par"));
  assert.equal(ended.status, 409, "a step that is not running cannot be written to");
  const bad = await messageRoute.POST(req("/api/workspaces/desk/runs/run-par/message", editor, { text: "x", step: 9 }), ctx("run-par"));
  assert.equal(bad.status, 400);
  runWith("run-one", [step("done", "completed"), step("writer", "running")]);
  const only = await messageRoute.POST(req("/api/workspaces/desk/runs/run-one/message", editor, { text: "only you" }), ctx("run-one"));
  assert.equal(only.status, 200);
  // One running step: the run-level inbox, which that step reads whether or
  // not its lease names its step.
  assert.equal((await pendingMessages("acme", "run-one"))[0].text, "only you");
});

test("answer: refused (409) when the question was closed, marked unanswered, or its step is no longer running", async () => {
  resetOperatorMemory();
  runWith("run-cl", [step("writer", "running")]);
  const closed = await postQuestion("acme", "run-cl", { question: "a?", step: 0 });
  await closeQuestion("acme", "run-cl", closed.id);
  const r1 = await answerRoute.POST(req("/api/workspaces/desk/runs/run-cl/answer", editor, { question: closed.id, answer: "x" }), ctx("run-cl"));
  assert.equal(r1.status, 409);
  assert.match((await r1.json()).error, /no longer waiting|closed/);

  const q2 = await postQuestion("acme", "run-un", { question: "b?" });
  runWith("run-un", [step("writer", "running", { questions: [{ id: q2.id, question: "b?", askedAt: new Date().toISOString(), unanswered: true }] })]);
  const r2 = await answerRoute.POST(req("/api/workspaces/desk/runs/run-un/answer", editor, { question: q2.id, answer: "x" }), ctx("run-un"));
  assert.equal(r2.status, 409);

  const q3 = await postQuestion("acme", "run-end", { question: "c?", step: 0 });
  runWith("run-end", [step("writer", "completed"), step("next", "running")]);
  const r3 = await answerRoute.POST(req("/api/workspaces/desk/runs/run-end/answer", editor, { question: q3.id, answer: "x" }), ctx("run-end"));
  assert.equal(r3.status, 409);
});

test("approvals: a closed question is not listed; a question names the step that asked", async () => {
  resetOperatorMemory();
  runWith("run-ap", [step("writer", "running"), step("checker", "running")]);
  const gone = await postQuestion("acme", "run-ap", { question: "old?", step: 0 });
  await closeQuestion("acme", "run-ap", gone.id);
  await postQuestion("acme", "run-ap", { question: "new?", step: 1 });
  const res = await approvalsRoute.GET(new NextRequest("http://x/api/approvals", { headers: { authorization: `Bearer ${editor}` } }));
  const body = await res.json();
  assert.deepEqual(body.questions.map((q: { question: string }) => q.question), ["new?"]);
  assert.equal(body.questions[0].agent, "checker");
  assert.equal(body.questions[0].step, 1);
});
