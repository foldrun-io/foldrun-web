// Session messages through the routes, with the database (19 Nov 2026):
// sending and reading (…/sessions/<context>/messages), a turn including
// them (`messages` on …/agents/<agent>/run), all or none, one turn only.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/session-messages-db.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-session-messages-db-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

const TENANT = `smdb${Date.now().toString(36)}`;
for (const ws of ["desk", "other"]) {
  const d = path.join(process.env.FOLDRUN_DATA, TENANT, "workspaces", ws);
  fs.mkdirSync(path.join(d, "agents", "coder"), { recursive: true });
  fs.writeFileSync(path.join(d, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
  fs.writeFileSync(path.join(d, "agents", "coder", "agent.md"), "---\nname: coder\n---\nYou code.\n");
}

test("send, read, include in one turn only; all or none; who may", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey } = await import("../server/auth.ts");
  const messages = await import("../app/v1/workspaces/[workspace]/sessions/[context]/messages/route.ts");
  const run = await import("../app/v1/workspaces/[workspace]/agents/[agent]/run/route.ts");
  const { readRun } = await import("@/lib/store");

  const editor = (await createApiKey(TENANT, "ed", "ana@acme.test", undefined, "editor")).key;
  const viewer = (await createApiKey(TENANT, "view", undefined, undefined, "viewer")).key;
  const elsewhere = (await createApiKey(TENANT, "other only", undefined, undefined, "editor", ["other"])).key;

  const req = (method: string, key: string, p: string, body?: unknown) =>
    new NextRequest(`https://app.example.test${p}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const M = (ctx: string, q = "") => `/v1/workspaces/desk/sessions/${ctx}/messages${q}`;
  const mp = (context: string) => ({ params: Promise.resolve({ workspace: "desk", context }) });
  const rp = { params: Promise.resolve({ workspace: "desk", agent: "coder" }) };

  // Who may send and read.
  assert.equal((await messages.POST(req("POST", viewer, M("code-b"), { text: "hi" }), mp("code-b"))).status, 403, "a viewer may not send");
  assert.equal((await messages.POST(req("POST", elsewhere, M("code-b"), { text: "hi" }), mp("code-b"))).status, 403, "a key for another project may not send here");
  assert.equal((await messages.POST(req("POST", editor, M("code-b"), { text: "  " }), mp("code-b"))).status, 400);
  assert.equal((await messages.POST(req("POST", editor, M("has space"), { text: "x" }), mp("has space"))).status, 400);
  assert.equal((await messages.POST(req("POST", editor, M("code-b"), { text: "x", from: "bad id" }), mp("code-b"))).status, 400);

  const sent = await messages.POST(req("POST", editor, M("code-b"), { text: "the API moved to /v2", from: "code-a" }), mp("code-b"));
  assert.equal(sent.status, 201);
  const m1 = (await sent.json()).message;
  assert.equal(m1.from, "ana@acme.test");
  assert.equal(m1.fromContext, "code-a");
  const m2 = (await (await messages.POST(req("POST", editor, M("code-b"), { text: "and tests are green" }), mp("code-b"))).json()).message;

  const read = await (await messages.GET(req("GET", viewer, M("code-b", "?waiting=1")), mp("code-b"))).json();
  assert.deepEqual(read.messages.map((m: { id: string }) => m.id), [m1.id, m2.id], "a viewer reads; oldest first");
  assert.equal((await messages.GET(req("GET", elsewhere, M("code-b")), mp("code-b"))).status, 403);

  // A turn includes them: only with a context; all or none.
  assert.equal((await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "go", messages: [m1.id] }), rp)).status, 400, "no context, no messages");
  assert.equal((await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "go", context: "code-b", messages: ["not-an-id"] }), rp)).status, 400);
  const wrong = await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "go", context: "code-c", messages: [m1.id] }), rp);
  assert.equal(wrong.status, 409, "another conversation's message is refused");
  assert.deepEqual((await wrong.json()).refused, [m1.id]);

  const ok = await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "go", context: "code-b", messages: [m2.id, m1.id] }), rp);
  assert.equal(ok.status, 200, await ok.clone().text());
  const started = await ok.json();
  assert.deepEqual(started.messages, [m1.id, m2.id], "in the order sent");
  const record = readRun(TENANT, "desk", started.runId)!;
  assert.deepEqual(record.sessionMessages?.map((m) => [m.id, m.from, m.text]), [
    [m1.id, "ana@acme.test", "the API moved to /v2"],
    [m2.id, "ana@acme.test", "and tests are green"],
  ]);

  // Taken: nothing waits, the list says which run used them, a second turn is refused.
  assert.deepEqual((await (await messages.GET(req("GET", viewer, M("code-b", "?waiting=1")), mp("code-b"))).json()).messages, []);
  const all = await (await messages.GET(req("GET", viewer, M("code-b")), mp("code-b"))).json();
  assert.ok(all.messages.every((m: { run?: string }) => m.run === started.runId));
  const again = await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "again", context: "code-b", messages: [m1.id] }), rp);
  assert.equal(again.status, 409);
  // More than fits in one turn's block: those that fit go in and are the
  // run's; the rest wait again, named in `left` — none marked used unread.
  const big: string[] = [];
  for (let i = 0; i < 6; i++) big.push((await (await messages.POST(req("POST", editor, M("code-z"), { text: String(i).repeat(4000) }), mp("code-z"))).json()).message.id);
  const part = await run.POST(req("POST", editor, "/v1/workspaces/desk/agents/coder/run", { task: "go", context: "code-z", messages: big }), rp);
  assert.equal(part.status, 200);
  const partBody = await part.json();
  assert.ok(partBody.messages.length >= 3 && partBody.messages.length < 6, `fit ${partBody.messages.length}`);
  assert.deepEqual([...partBody.messages, ...partBody.left], big);
  assert.equal(readRun(TENANT, "desk", partBody.runId)!.sessionMessages!.length, partBody.messages.length);
  const stillWaiting = await (await messages.GET(req("GET", viewer, M("code-z", "?waiting=1")), mp("code-z"))).json();
  assert.deepEqual(stillWaiting.messages.map((m: { id: string }) => m.id), partBody.left);

  const { db } = await import("@/platform/db.ts");
  await db()?.query("DELETE FROM session_messages WHERE tenant=$1", [TENANT]);
});
