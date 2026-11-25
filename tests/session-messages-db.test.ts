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

test("take (FOL-236): a turn on a computer marks messages used — once, who may, a bad body refused; the project's conversations listed", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey } = await import("../server/auth.ts");
  const messages = await import("../app/v1/workspaces/[workspace]/sessions/[context]/messages/route.ts");
  const take = await import("../app/v1/workspaces/[workspace]/sessions/[context]/messages/take/route.ts");
  const sessions = await import("../app/v1/workspaces/[workspace]/sessions/route.ts");
  const { writeRun } = await import("@/lib/store");
  const { runContext } = await import("@/lib/conversation");

  const editor = (await createApiKey(TENANT, "ed2", "ana@acme.test", undefined, "editor")).key;
  const viewer = (await createApiKey(TENANT, "view2", undefined, undefined, "viewer")).key;
  const req = (method: string, key: string, p: string, body?: unknown) =>
    new NextRequest(`https://app.example.test${p}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const mp = (context: string) => ({ params: Promise.resolve({ workspace: "desk", context }) });
  const T = (ctx: string) => `/v1/workspaces/desk/sessions/${ctx}/messages/take`;

  const one = (await (await messages.POST(req("POST", editor, `/v1/workspaces/desk/sessions/code-tk/messages`, { text: "one" }), mp("code-tk"))).json()).message;
  assert.equal((await take.POST(req("POST", viewer, T("code-tk"), { ids: [one.id] }), mp("code-tk"))).status, 403, "a viewer includes nothing in a turn");
  assert.equal((await take.POST(req("POST", editor, T("code-tk"), { ids: [] }), mp("code-tk"))).status, 400);
  assert.equal((await take.POST(req("POST", editor, T("code-tk"), { ids: [42] }), mp("code-tk"))).status, 400);
  const first = await take.POST(req("POST", editor, T("code-tk"), { ids: [one.id, "sm-none"] }), mp("code-tk"));
  assert.equal(first.status, 200);
  const got = await first.json();
  assert.deepEqual(got.taken.map((m: any) => m.id), [one.id]);
  assert.deepEqual(got.refused, ["sm-none"]);
  assert.match(got.hold, /^lt-/);
  assert.deepEqual((await (await take.POST(req("POST", editor, T("code-tk"), { ids: [one.id] }), mp("code-tk"))).json()).refused, [one.id], "held for one turn only");
  assert.equal((await take.POST(req("POST", editor, T("code-tk"), { hold: got.hold, outcome: "maybe" }), mp("code-tk"))).status, 400);
  assert.equal((await take.POST(req("POST", editor, T("code-tk"), { hold: "nope", outcome: "used" }), mp("code-tk"))).status, 400);
  assert.deepEqual(await (await take.POST(req("POST", editor, T("code-zz"), { hold: got.hold, outcome: "used" }), mp("code-zz"))).json(), { used: 0 }, "not through another conversation");
  assert.deepEqual(await (await take.POST(req("POST", editor, T("code-tk"), { hold: got.hold, outcome: "used" }), mp("code-tk"))).json(), { used: 1 });
  const listed = (await (await messages.GET(req("GET", editor, `/v1/workspaces/desk/sessions/code-tk/messages`), mp("code-tk"))).json()).messages;
  assert.equal(listed.find((m: any) => m.id === one.id).usedLocally, true);

  writeRun(TENANT, "desk", { id: "run-conv-1", flow: "adhoc:coder", status: "completed", startedAt: "2026-11-24T01:00:00.000Z", finishedAt: "2026-11-24T01:01:00.000Z", context: runContext("code-tk"), steps: [{ agent: "coder", instruction: "x", group: 1, optional: false, status: "completed", events: [], costUsd: null }] } as any);
  const list = await sessions.GET(req("GET", viewer, "/v1/workspaces/desk/sessions"), { params: Promise.resolve({ workspace: "desk" }) });
  assert.equal(list.status, 200, "any member reads the list");
  const rows = (await list.json()).sessions;
  const mine = rows.find((x: any) => x.context === "code-tk");
  assert.deepEqual([mine.turns, mine.lastRun, mine.agent], [1, "run-conv-1", "coder"]);
  assert.ok(rows.every((x: any, i: number) => i === 0 || rows[i - 1].lastAt >= x.lastAt), "the most recently used first");

  // FOL-264: a conversation's name.
  const conv = await import("../app/v1/workspaces/[workspace]/sessions/[context]/route.ts");
  const P = "/v1/workspaces/desk/sessions/code-tk";
  assert.equal((await conv.PATCH(req("PATCH", viewer, P, { name: "x" }), mp("code-tk"))).status, 403, "a viewer names nothing");
  assert.equal((await conv.PATCH(req("PATCH", editor, P, { name: "evil\u202Ename" }), mp("code-tk"))).status, 400);
  assert.equal((await conv.PATCH(req("PATCH", editor, P, {}), mp("code-tk"))).status, 400);
  assert.deepEqual(await (await conv.PATCH(req("PATCH", editor, P, { name: " the fix " }), mp("code-tk"))).json(), { context: "code-tk", name: "the fix" });
  const named = (await (await sessions.GET(req("GET", viewer, "/v1/workspaces/desk/sessions"), { params: Promise.resolve({ workspace: "desk" }) })).json()).sessions;
  assert.equal(named.find((x: any) => x.context === "code-tk").name, "the fix");
  assert.deepEqual(await (await conv.PATCH(req("PATCH", editor, P, { name: null }), mp("code-tk"))).json(), { context: "code-tk", name: null });
});

test("the thread between two conversations, both ways, and what one sent (FOL-307)", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey } = await import("../server/auth.ts");
  const messages = await import("../app/v1/workspaces/[workspace]/sessions/[context]/messages/route.ts");
  const editor = (await createApiKey(TENANT, "ed307", "ana@acme.test", undefined, "editor")).key;
  const viewer = (await createApiKey(TENANT, "view307", undefined, undefined, "viewer")).key;
  const elsewhere = (await createApiKey(TENANT, "other307", undefined, undefined, "editor", ["other"])).key;
  const req = (method: string, key: string, p: string, body?: unknown) =>
    new NextRequest(`https://app.example.test${p}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const M = (ctx: string, q = "") => `/v1/workspaces/desk/sessions/${ctx}/messages${q}`;
  const mp = (context: string) => ({ params: Promise.resolve({ workspace: "desk", context }) });
  const send = async (to: string, from: string, text: string) => (await (await messages.POST(req("POST", editor, M(to), { text, from }), mp(to))).json()).message;
  const a = await send("t307-y", "t307-x", "x asks y");
  const b = await send("t307-x", "t307-y", "y answers x");
  await send("t307-z", "t307-x", "x tells z");
  const thread = await (await messages.GET(req("GET", viewer, M("t307-x", "?with=t307-y")), mp("t307-x"))).json();
  assert.equal(thread.with, "t307-y");
  assert.deepEqual(thread.messages.map((m: any) => [m.id, m.direction]), [[a.id, "out"], [b.id, "in"]]);
  const sent = await (await messages.GET(req("GET", viewer, M("t307-x", "?sent=1")), mp("t307-x"))).json();
  assert.equal(sent.sent, true);
  assert.deepEqual(sent.messages.map((m: any) => m.context), ["t307-y", "t307-z"]);
  assert.equal((await messages.GET(req("GET", viewer, M("t307-x", "?with=t307-x")), mp("t307-x"))).status, 400, "not with itself");
  assert.equal((await messages.GET(req("GET", viewer, M("t307-x", "?with=bad id")), mp("t307-x"))).status, 400);
  assert.equal((await messages.GET(req("GET", elsewhere, M("t307-x", "?with=t307-y")), mp("t307-x"))).status, 403, "another project's key reads nothing here");
});
