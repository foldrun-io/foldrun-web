// Serving published flows over A2A 1.0, end to end through the routes (1 Nov
// 2026): the restricted key, its refusals everywhere else, the card, and
// SendMessage / GetTask / ListTasks / CancelTask — with every lookup scoped
// to the account, the workspace, the flow (granted and published) and the
// caller.
//
// No agent runs (FOLDRUN_DISABLE_WORKER): where a run must move, the test
// writes its record as the worker would.
//
//   node --import ./tests/register.mjs --test tests/a2a-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-a2a-routes-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_PUBLIC_URL = "https://app.example.test";
process.env.FOLDRUN_A2A_WAIT_MS = "0";
process.env.FOLDRUN_A2A_POLL_MS = "25";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-a2a";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { readRun, writeRun, listRunSummaries } = await import("@/lib/store");
type Req = InstanceType<typeof NextRequest>;
type Handler<P> = (req: Req, ctx: { params: Promise<P> }) => Promise<Response>;
type Rpc = { jsonrpc: string; id: unknown; result?: any; error?: { code: number; message: string; data?: any[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const keysRoute = (await import("../app/api/keys/route.ts")) as { POST: (req: Req) => Promise<Response>; GET: (req: Req) => Promise<Response> };
const rotateRoute = (await import("../app/api/keys/[id]/rotate/route.ts")) as { POST: Handler<{ id: string }> };
const rpcRoute = (await import("../app/a2a/[tenant]/[workspace]/flows/[flow]/route.ts")) as { POST: Handler<{ tenant: string; workspace: string; flow: string }> };
const cardRoute = (await import("../app/a2a/[tenant]/[workspace]/flows/[flow]/.well-known/agent-card.json/route.ts")) as { GET: Handler<{ tenant: string; workspace: string; flow: string }> };
const indexRoute = (await import("../app/a2a/[tenant]/[workspace]/route.ts")) as { GET: Handler<{ tenant: string; workspace: string }> };
const wsA2a = (await import("../app/api/workspaces/[workspace]/a2a/route.ts")) as { GET: Handler<{ workspace: string }> };
const runsRoute = (await import("../app/api/workspaces/[workspace]/runs/route.ts")) as { GET: Handler<{ workspace: string }> };
const sourceRoute = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as { GET: Handler<{ workspace: string }>; PUT: Handler<{ workspace: string }>; PATCH: Handler<{ workspace: string }> };
const storageRoute = (await import("../app/api/workspaces/[workspace]/storage/route.ts")) as { GET: Handler<{ workspace: string }> };
const approveRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/approve/route.ts")) as { POST: Handler<{ workspace: string; runId: string }> };
const answerRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/answer/route.ts")) as { POST: Handler<{ workspace: string; runId: string }> };
const flowRunRoute = (await import("../app/api/workspaces/[workspace]/flows/[flow]/run/route.ts")) as { POST: Handler<{ workspace: string; flow: string }> };
const flowRoute = (await import("../app/api/workspaces/[workspace]/flows/[flow]/route.ts")) as { PATCH: Handler<{ workspace: string; flow: string }> };

function workspace(tenant: string, name: string, flows: Record<string, string>) {
  const ws = path.join(DATA, tenant, "workspaces", name);
  fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${name}\n---\n`);
  fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
  for (const [f, text] of Object.entries(flows)) fs.writeFileSync(path.join(ws, "flows", `${f}.md`), text);
  return ws;
}
const flow = (name: string, a2a: string | null, body = "1. [[writer]] — find leads\n", extra = "") =>
  `---\nname: ${name}\ndescription: internal note — uses CRM_TOKEN\n${extra}${a2a ? `a2a:\n${a2a}` : ""}---\n\n${body}`;

const WS = workspace("acme", "desk", {
  leads: flow("leads", "  publish: true\n  name: Lead finder\n  description: Finds leads.\n  examples: [dentists in Perth]\n"),
  card: flow("card", "  publish: true\n  public_card: true\n"),
  // Published when its key is minted (a key names published flows only,
  // FOL-112 N6), unpublished just after: the key no longer reaches it.
  hidden: flow("hidden", "  publish: true\n"),
  plain: flow("plain", null),
  gated: flow("gated", "  publish: true\n", "1!. [[writer]] — send it\n"),
  once: flow("once", "  publish: true\n", "1. [[writer]] — once\n", "overlap: skip\n"),
  typed: flow("typed", "  publish: true\n  input:\n    type: object\n    required: [city]\n    properties:\n      city: { type: string }\n"),
  ungranted: flow("ungranted", "  publish: true\n"),
});
workspace("acme", "other", { leads: flow("leads", "  publish: true\n") });
workspace("rival", "desk", { leads: flow("leads", "  publish: true\n") });

const admin = (await createApiKey("acme", "admin", undefined, undefined, "admin")).key;
const editor = (await createApiKey("acme", "ed", undefined, undefined, "editor")).key;
const viewer = (await createApiKey("acme", "view", undefined, undefined, "viewer")).key;
const rivalAdmin = (await createApiKey("rival", "admin", undefined, undefined, "admin")).key;

const json = (key: string | null, extra: Record<string, string> = {}) => ({ ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...extra });

async function mint(by: string, body: Record<string, unknown>) {
  const res = await keysRoute.POST(new NextRequest("https://app.example.test/api/keys", { method: "POST", headers: json(by), body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const at = { tenant: "acme", workspace: "desk" };
let n = 0;
async function call(key: string | null, method: string, params: unknown, where: { tenant?: string; workspace?: string; flow?: string } = {}, headers: Record<string, string> = { "a2a-version": "1.0" }) {
  const p = { ...at, flow: "leads", ...where };
  const res = await rpcRoute.POST(
    new NextRequest(`https://app.example.test/a2a/${p.tenant}/${p.workspace}/flows/${p.flow}`, { method: "POST", headers: json(key, headers), body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) }),
    { params: Promise.resolve(p) },
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as Rpc };
}
const send = (key: string, text: string, opts: { messageId?: string; flow?: string; extra?: Record<string, unknown>; config?: Record<string, unknown> } = {}) =>
  call(key, "SendMessage", { message: { messageId: opts.messageId ?? `m-${++n}`, role: "ROLE_USER", parts: [{ text }], ...opts.extra }, configuration: { returnImmediately: true, ...opts.config } }, { flow: opts.flow ?? "leads" });

// A cap well above what these tests leave open (runs here never finish
// unless a test finishes them).
const minted = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads", "card", "hidden", "gated", "once", "typed"], label: "partner", maxTasks: 50 });
const a2a = minted.body.key as string;
const secondMinted = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], label: "someone else" });
const second = secondMinted.body.key as string;
fs.writeFileSync(path.join(WS, "flows", "hidden.md"), flow("hidden", "  publish: false\n"));
const rivalA2a = (await mint(rivalAdmin, { purpose: "a2a", workspace: "desk", flows: ["leads"] })).body.key as string;

test("an admin mints an A2A key for one workspace's flows; the request is checked", async () => {
  assert.equal(minted.status, 200);
  assert.equal(minted.body.purpose, "a2a");
  assert.equal(minted.body.workspace, "desk");
  assert.deepEqual(minted.body.workspaces, ["desk"]);
  assert.equal(minted.body.maxTasks, 50);
  assert.equal(secondMinted.body.maxTasks, 10, "the default");
  assert.match(a2a, /^fr_a2a_[0-9a-f]{48}$/, "an A2A key says so (FOL-154)");
  assert.equal((await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["nope"] })).status, 400, "an unknown flow");
  const unpublished = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads", "plain", "hidden"] });
  assert.equal(unpublished.status, 400, "a flow not published now (FOL-112 N6)");
  assert.match(unpublished.body.error, /^plain, hidden are not published over A2A in desk — publish them first/);
  assert.equal((await mint(admin, { purpose: "a2a", workspace: "nowhere", flows: ["leads"] })).status, 400);
  assert.equal((await mint(admin, { purpose: "a2a", workspace: "desk", flows: [] })).status, 400);
  assert.equal((await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], role: "admin" })).status, 400, "an A2A key takes no role");
  assert.equal((await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], maxTasks: 0 })).status, 400);
  assert.equal((await mint(admin, { purpose: "other", workspace: "desk", flows: ["leads"] })).status, 400);
  assert.equal((await mint(editor, { purpose: "a2a", workspace: "desk", flows: ["leads"] })).status, 403, "minting needs keys:manage");
  const listed = (await (await keysRoute.GET(new NextRequest("https://app.example.test/api/keys", { headers: json(admin) }))).json()) as { keys: { id: string; purpose?: string; a2a?: { principal: string } }[] };
  const row = listed.keys.find((k) => k.id === minted.body.id)!;
  assert.equal(row.purpose, "a2a");
  assert.equal(row.a2a!.principal, minted.body.id, "a fresh key is its own principal");
});

test("an A2A key is refused by every ordinary /api route — runs, source, storage, approve, answer, keys, starting a flow", async () => {
  const run = (await send(a2a, "hello", { flow: "gated" })).body.result.task;
  const runId = readRunIdOf(run.id);
  const ctxWs = { params: Promise.resolve({ workspace: "desk" }) };
  const ctxRun = { params: Promise.resolve({ workspace: "desk", runId }) };
  const u = (p: string) => `https://app.example.test/api/workspaces/desk/${p}`;
  const refusals = [
    await runsRoute.GET(new NextRequest(u("runs"), { headers: json(a2a) }), ctxWs),
    await sourceRoute.GET(new NextRequest(u("source?path=flows/leads.md"), { headers: json(a2a) }), ctxWs),
    await storageRoute.GET(new NextRequest(u("storage"), { headers: json(a2a) }), ctxWs),
    await approveRoute.POST(new NextRequest(u(`runs/${runId}/approve`), { method: "POST", headers: json(a2a), body: JSON.stringify({ decision: "approve" }) }), ctxRun),
    await answerRoute.POST(new NextRequest(u(`runs/${runId}/answer`), { method: "POST", headers: json(a2a), body: JSON.stringify({ question: "q", answer: "yes" }) }), ctxRun),
    await flowRunRoute.POST(new NextRequest(u("flows/leads/run"), { method: "POST", headers: json(a2a), body: "{}" }), { params: Promise.resolve({ workspace: "desk", flow: "leads" }) }),
    await keysRoute.GET(new NextRequest("https://app.example.test/api/keys", { headers: json(a2a) })),
  ];
  for (const r of refusals) {
    assert.equal(r.status, 403);
    assert.match(((await r.json()) as { error: string }).error, /A2A key/);
  }
  assert.equal(readRun("acme", "desk", runId)!.steps[0]!.status, "pending", "nothing was approved");
});

test("/a2a takes an A2A key only — no key is 401 with a challenge, an API key 403", async () => {
  const none = await call(null, "GetTask", { id: "x" });
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /^Bearer/);
  assert.equal(none.body.error!.code, -32000);
  const api = await call(admin, "GetTask", { id: "x" });
  assert.equal(api.status, 403);
  assert.equal(api.body.error!.data![0].reason, "PERMISSION_DENIED");
  assert.equal((await call("mda_" + "0".repeat(48), "GetTask", { id: "x" })).status, 401);
});

test("cross-account, other workspace, ungranted, unpublished and missing flows are all the same 404", async () => {
  for (const where of [
    { tenant: "rival" }, // another account's URL with this account's key
    { workspace: "other" }, // a workspace the key does not name
    { flow: "ungranted" }, // published, but not named by the key
    { flow: "hidden" }, // named, not published
    { flow: "plain" }, // no a2a: at all
    { flow: "missing" },
  ]) {
    const r = await call(a2a, "GetTask", { id: "x" }, where);
    assert.equal(r.status, 404, JSON.stringify(where));
    assert.equal(r.body.error!.data![0].reason, "AGENT_NOT_FOUND");
  }
  assert.equal((await call(rivalA2a, "GetTask", { id: "x" })).status, 404, "another account's key on this account's URL");
});

test("the card: private needs the key; public_card is open; an unpublished flow has none; caching headers", async () => {
  const card = (key: string | null, flowName: string, headers: Record<string, string> = {}) =>
    cardRoute.GET(new NextRequest(`https://app.example.test/a2a/acme/desk/flows/${flowName}/.well-known/agent-card.json`, { headers: { ...json(key), ...headers } }), { params: Promise.resolve({ ...at, flow: flowName }) });
  assert.equal((await card(null, "leads")).status, 401);
  const ok = await card(a2a, "leads");
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control") ?? "", /^private/);
  const body = (await ok.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(body.name, "Lead finder");
  assert.equal(body.supportedInterfaces[0].url, "https://app.example.test/a2a/acme/desk/flows/leads");
  assert.ok(!JSON.stringify(body).includes("CRM_TOKEN"), "the flow's own description is not the card's when one is authored");
  const etag = ok.headers.get("etag")!;
  assert.equal((await card(a2a, "leads", { "if-none-match": etag })).status, 304);
  const open = await card(null, "card");
  assert.equal(open.status, 200);
  assert.match(open.headers.get("cache-control") ?? "", /^public/);
  assert.equal((await card(null, "hidden")).status, 401, "without a key, no card and a private card look the same");
  assert.equal((await card(a2a, "hidden")).status, 404);
  assert.equal((await card(a2a, "ungranted")).status, 404);
  assert.equal((await card(rivalA2a, "leads")).status, 404);
});

test("a public card read with no key is rate-limited per address when the proxy is trusted", async () => {
  const { PUBLIC_CARD_LIMITS } = await import("../server/a2a-service.ts");
  const read = (ip: string) =>
    cardRoute.GET(new NextRequest("https://app.example.test/a2a/acme/desk/flows/card/.well-known/agent-card.json", { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ ...at, flow: "card" }) });
  const before = process.env.FOLDRUN_TRUST_PROXY;
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    for (let i = 0; i < PUBLIC_CARD_LIMITS.perIp; i++) assert.equal((await read("203.0.113.7")).status, 200);
    const over = await read("203.0.113.7");
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    const body = (await over.json()) as Rpc;
    assert.equal(body.error!.code, -32000);
    assert.ok(JSON.stringify(body.error).includes("RATE_LIMITED"));
    assert.equal((await read("203.0.113.8")).status, 200, "another address has its own count");
    // A private card is never served on this path, so it is never counted here.
    assert.equal((await cardRoute.GET(new NextRequest("https://app.example.test/a2a/acme/desk/flows/leads/.well-known/agent-card.json", { headers: { "x-forwarded-for": "203.0.113.7", ...json(a2a) } }), { params: Promise.resolve({ ...at, flow: "leads" }) })).status, 200);
  } finally {
    if (before === undefined) delete process.env.FOLDRUN_TRUST_PROXY;
    else process.env.FOLDRUN_TRUST_PROXY = before;
  }
});

test("the index lists the key's published flows only", async () => {
  const res = await indexRoute.GET(new NextRequest("https://app.example.test/a2a/acme/desk", { headers: json(a2a) }), { params: Promise.resolve(at) });
  const { agents } = (await res.json()) as { agents: { flow: string; card: string }[] };
  assert.deepEqual(agents.map((a) => a.flow).sort(), ["card", "gated", "leads", "once", "typed"], "not hidden (unpublished), not ungranted");
  const wrong = await indexRoute.GET(new NextRequest("https://app.example.test/a2a/acme/other", { headers: json(a2a) }), { params: Promise.resolve({ tenant: "acme", workspace: "other" }) });
  assert.equal(wrong.status, 404);
});

test("A2A-Version is required (empty is 0.3); unserved methods answer the spec's errors", async () => {
  assert.equal((await call(a2a, "GetTask", { id: "x" }, {}, {})).body.error!.code, -32009);
  assert.equal((await call(a2a, "GetTask", { id: "x" }, {}, { "a2a-version": "0.3" })).body.error!.code, -32009);
  assert.equal((await call(a2a, "SendStreamingMessage", {})).body.error!.code, -32004);
  assert.equal((await call(a2a, "SubscribeToTask", { id: "x" })).body.error!.code, -32004);
  assert.equal((await call(a2a, "CreateTaskPushNotificationConfig", { taskId: "x", url: "https://cb" })).body.error!.code, -32003);
  assert.equal((await call(a2a, "GetExtendedAgentCard", {})).body.error!.code, -32004);
  assert.equal((await call(a2a, "message/send", {})).body.error!.code, -32601, "0.3's method names are not 1.0's");
  // A name an object inherits is still an unknown method, not an internal error.
  for (const m of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "__defineGetter__"]) {
    const r = await call(a2a, m, {});
    assert.equal(r.body.error!.code, -32601, m);
    assert.equal(r.body.error!.message, "Method not found", m);
  }
  const ok = await call(a2a, "GetTask", { id: "nope" });
  assert.equal(ok.status, 200, "a JSON-RPC error rides a 200");
  assert.equal(ok.headers.get("a2a-version"), "1.0");
  assert.equal(ok.body.error!.code, -32001);
});

/** The run behind a task, through its record's correlation. */
function readRunIdOf(taskId: string): string {
  const row = listRunSummaries("acme", "desk").find((r) => r.a2a?.task === taskId);
  assert.ok(row, `a run for task ${taskId}`);
  return row.id;
}

test("SendMessage: the task is written first, the run carries only a correlation, the request fenced in step 1", async () => {
  const r = await send(a2a, "dentists in Perth", { extra: { contextId: "conv-1" } });
  const task = r.body.result.task;
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(task.contextId, "conv-1", "the caller's context is kept");
  assert.equal(task.status.state, "TASK_STATE_SUBMITTED");
  assert.equal(task.history[0].parts[0].text, "dentists in Perth");
  const run = readRun("acme", "desk", readRunIdOf(task.id))!;
  assert.equal(run.trigger, "a2a");
  assert.deepEqual(run.a2a, { task: task.id, key: minted.body.id });
  assert.equal(run.startedBy, undefined, "no person started it");
  assert.match(run.steps[0]!.instruction, /<a2a_request>[\s\S]*dentists in Perth[\s\S]*<\/a2a_request>$/);
  assert.ok(!JSON.stringify(r.body).includes(run.id), "the run id never reaches the caller");
  const gen = (await send(a2a, "no context")).body.result.task;
  assert.match(gen.contextId, /^[0-9a-f-]{36}$/, "one is made when none is sent");
});

test("dedupe on messageId: the same message is the same task (one run); a different one is refused", async () => {
  const runsBefore = listRunSummaries("acme", "desk").length;
  const first = (await send(a2a, "same", { messageId: "dup-1" })).body.result.task;
  const again = (await send(a2a, "same", { messageId: "dup-1", config: { historyLength: 0 } })).body.result.task;
  assert.equal(again.id, first.id);
  assert.equal(again.history, undefined, "the delivery preferences are not the message");
  assert.equal(listRunSummaries("acme", "desk").length, runsBefore + 1, "one run");
  const other = await send(a2a, "different", { messageId: "dup-1" });
  assert.equal(other.body.error!.code, -32602);
  assert.match(other.body.error!.message, /messageId was already used/);
  // Another caller's identical messageId is its own task.
  assert.notEqual((await send(second, "same", { messageId: "dup-1" })).body.result.task.id, first.id);
});

test("GetTask and CancelTask see only the caller's own tasks", async () => {
  const mine = (await send(a2a, "mine")).body.result.task;
  for (const [key, where] of [[second, {}], [rivalA2a, { tenant: "rival" }]] as const) {
    assert.equal((await call(key, "GetTask", { id: mine.id }, where)).body.error!.code, -32001);
    assert.equal((await call(key, "CancelTask", { id: mine.id }, where)).body.error!.code, -32001);
  }
  // On another flow's endpoint, even with the right key, the task is not there.
  assert.equal((await call(a2a, "GetTask", { id: mine.id }, { flow: "card" })).body.error!.code, -32001);
  assert.equal((await call(a2a, "GetTask", { id: mine.id })).body.result.id, mine.id);
});

test("CancelTask stops the run and is idempotent; an ended task is not cancelable", async () => {
  const t = (await send(a2a, "to cancel")).body.result.task;
  const once = await call(a2a, "CancelTask", { id: t.id });
  assert.equal(once.body.result.status.state, "TASK_STATE_CANCELED");
  const runId = readRunIdOf(t.id);
  assert.equal(readRun("acme", "desk", runId)!.stopRequested, true);
  // The trail names the caller, not "a person" (the key's label: partner).
  const stoppedRun = readRun("acme", "desk", runId)!;
  assert.equal(stoppedRun.stoppedBy, "A2A caller partner");
  const trail = stoppedRun.steps.flatMap((s) => s.events.map((e) => e.text));
  assert.ok(trail.some((x) => x.startsWith("run cancelled by A2A caller partner")), trail.join(" | "));
  assert.ok(!trail.some((x) => /by a person/.test(x)), trail.join(" | "));
  const twice = await call(a2a, "CancelTask", { id: t.id });
  assert.equal(twice.body.result.status.state, "TASK_STATE_CANCELED", "the same answer again");
  assert.equal((await call(a2a, "GetTask", { id: t.id })).body.result.status.state, "TASK_STATE_CANCELED");

  const done = (await send(a2a, "to finish")).body.result.task;
  finish(readRunIdOf(done.id), "completed", "Three leads.");
  const got = (await call(a2a, "GetTask", { id: done.id })).body.result;
  assert.equal(got.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(got.artifacts[0].parts, [{ text: "Three leads.", mediaType: "text/plain" }]);
  assert.equal((await call(a2a, "CancelTask", { id: done.id })).body.error!.code, -32002);
  assert.equal((await send(a2a, "more", { extra: { taskId: done.id } })).body.error!.code, -32004, "an ended task takes no more messages");
});

function finish(runId: string, status: "completed" | "failed", result: string) {
  const run = readRun("acme", "desk", runId)!;
  const now = new Date().toISOString();
  run.status = status;
  run.finishedAt = now;
  run.steps = run.steps.map((s) => ({ ...s, status, result, events: [...s.events, { t: now, type: "result", text: result }] })) as typeof run.steps;
  writeRun("acme", "desk", run);
}

test("an approval gate shows WORKING, 'waiting for a person' — and no A2A call decides it", async () => {
  const t = (await send(a2a, "send the email", { flow: "gated" })).body.result.task;
  const runId = readRunIdOf(t.id);
  const run = readRun("acme", "desk", runId)!;
  run.status = "awaiting-approval";
  run.parkedAt = new Date().toISOString();
  run.steps[0]!.status = "awaiting-approval";
  writeRun("acme", "desk", run);
  const got = (await call(a2a, "GetTask", { id: t.id }, { flow: "gated" })).body.result;
  assert.equal(got.status.state, "TASK_STATE_WORKING");
  assert.deepEqual(got.status.message.parts, [{ text: "waiting for a person" }]);
  assert.ok(!JSON.stringify(got).includes("approve"), "no approval link, no approver");
  // A follow-up message is not an approval.
  assert.equal((await send(a2a, "approve", { flow: "gated", extra: { taskId: t.id } })).body.error!.code, -32004);
  assert.equal(readRun("acme", "desk", runId)!.status, "awaiting-approval");
});

test("ListTasks: own tasks on this flow, newest first, paginated; bad params are -32602", async () => {
  const fresh = (await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"] })).body.key as string;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await send(fresh, `list ${i}`)).body.result.task.id);
  await send(second, "not mine");
  const page1 = (await call(fresh, "ListTasks", { pageSize: 2 })).body.result;
  assert.equal(page1.totalSize, 3);
  assert.equal(page1.pageSize, 2);
  assert.equal(page1.tasks.length, 2);
  assert.ok(page1.nextPageToken);
  assert.equal(page1.tasks[0].artifacts, undefined, "artifacts omitted unless asked");
  const page2 = (await call(fresh, "ListTasks", { pageSize: 2, pageToken: page1.nextPageToken })).body.result;
  assert.equal(page2.tasks.length, 1);
  assert.equal(page2.nextPageToken, "", "always present; empty on the last page");
  assert.deepEqual([...page1.tasks, ...page2.tasks].map((t: { id: string }) => t.id).sort(), [...ids].sort());
  assert.equal((await call(fresh, "ListTasks", { pageSize: 101 })).body.error!.code, -32602);
  assert.equal((await call(fresh, "ListTasks", { status: "working" })).body.error!.code, -32602);
  assert.equal((await call(fresh, "ListTasks", { pageToken: "forged" })).body.error!.code, -32602);
  const withArtifacts = (await call(fresh, "ListTasks", { includeArtifacts: true })).body.result;
  assert.deepEqual(withArtifacts.tasks[0].artifacts, []);
});

test("blocking SendMessage waits, bounded, and answers the finished task", async () => {
  process.env.FOLDRUN_A2A_WAIT_MS = "5000";
  try {
    const before = new Set(listRunSummaries("acme", "desk").map((r) => r.id));
    const pending = call(a2a, "SendMessage", { message: { messageId: "block-1", role: "ROLE_USER", parts: [{ text: "wait for it" }] } });
    // Play the worker: finish the run as soon as it appears.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const id = listRunSummaries("acme", "desk").find((r) => !before.has(r.id))?.id;
      if (id) {
        finish(id, "completed", "done");
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const res = (await pending).body.result.task;
    assert.equal(res.status.state, "TASK_STATE_COMPLETED");
    assert.equal(res.artifacts[0].parts[0].text, "done");
  } finally {
    process.env.FOLDRUN_A2A_WAIT_MS = "0";
  }
});

test("admission holds for A2A: overlap: skip is BUSY and leaves no task; the open-task cap; the input schema", async () => {
  const first = await send(a2a, "one", { flow: "once" });
  assert.ok(first.body.result);
  const busy = await send(a2a, "two", { flow: "once", messageId: "busy-1" });
  assert.equal(busy.body.error!.code, -32000);
  assert.equal(busy.body.error!.data![0].reason, "BUSY");
  assert.ok(!JSON.stringify(busy.body).includes("run-"), "the live run is not named");
  finish(readRunIdOf(first.body.result.task.id), "completed", "ok");
  assert.ok((await send(a2a, "two", { flow: "once", messageId: "busy-1" })).body.result, "the refused claim was handed back: the same message goes through later");

  const capped = (await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], maxTasks: 1 })).body.key as string;
  assert.ok((await send(capped, "a")).body.result);
  const over = await send(capped, "b");
  assert.equal(over.body.error!.data![0].reason, "TOO_MANY_TASKS");

  assert.equal((await send(a2a, "leads please", { flow: "typed" })).body.error!.code, -32602, "no data part for a flow with input:");
  const typed = await call(a2a, "SendMessage", { message: { messageId: "typed-1", role: "ROLE_USER", parts: [{ data: { city: "Perth" } }] }, configuration: { returnImmediately: true } }, { flow: "typed" });
  assert.ok(typed.body.result.task.id);
});

test("a rotated A2A key keeps its tasks", async () => {
  const k = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"] });
  const t = (await send(k.body.key, "before rotation")).body.result.task;
  const res = await rotateRoute.POST(new NextRequest(`https://app.example.test/api/keys/${k.body.id}/rotate`, { method: "POST", headers: json(admin), body: "{}" }), { params: Promise.resolve({ id: k.body.id }) });
  assert.equal(res.status, 200);
  const rotated = ((await res.json()) as { key: string }).key;
  assert.equal((await call(rotated, "GetTask", { id: t.id })).body.result.id, t.id);
  assert.equal((await call(k.body.key, "GetTask", { id: t.id })).status, 401, "the old key is revoked");
});

test("GET /api/workspaces/<ws>/a2a: the flows that say a2a:, the newest tasks; keys for admins only", async () => {
  const res = await wsA2a.GET(new NextRequest("https://app.example.test/api/workspaces/desk/a2a", { headers: json(admin) }), { params: Promise.resolve({ workspace: "desk" }) });
  const view = (await res.json()) as { flows: { flow: string; published: boolean; card: string }[]; keys: { label: string }[] | null; tasks: { key: { label: string | null }; state: string }[] };
  assert.deepEqual(view.flows.map((f) => f.flow).sort(), ["card", "gated", "hidden", "leads", "once", "typed", "ungranted"]);
  assert.equal(view.flows.find((f) => f.flow === "hidden")!.published, false);
  assert.equal(view.flows.find((f) => f.flow === "leads")!.card, "https://app.example.test/a2a/acme/desk/flows/leads/.well-known/agent-card.json");
  assert.ok(view.keys!.some((k) => k.label === "partner"));
  assert.ok(view.tasks.some((t) => t.key.label === "partner"));
  const asViewer = (await (await wsA2a.GET(new NextRequest("https://app.example.test/api/workspaces/desk/a2a", { headers: json(viewer) }), { params: Promise.resolve({ workspace: "desk" }) })).json()) as { keys: unknown };
  assert.equal(asViewer.keys, null);
});

test("publishing is an admin's: an editor cannot change a flow's a2a:, an admin can", async () => {
  const put = (key: string, rel: string, content: string) =>
    sourceRoute.PUT(new NextRequest("https://app.example.test/api/workspaces/desk/source", { method: "PUT", headers: json(key), body: JSON.stringify({ path: rel, content }) }), { params: Promise.resolve({ workspace: "desk" }) });
  const published = flow("plain", "  publish: true\n");
  const refused = await put(editor, "flows/plain.md", published);
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /a2a:/);
  assert.equal((await put(editor, "flows/plain.md", flow("plain", null, "1. [[writer]] — reworded\n"))).status, 200, "the rest of a flow stays an editor's");
  assert.equal((await put(editor, "flows/leads.md", fs.readFileSync(path.join(WS, "flows/leads.md"), "utf8").replace("find leads", "find more leads"))).status, 200, "editing a published flow without touching a2a: is fine");
  assert.equal((await put(admin, "flows/plain.md", published)).status, 200);
});

test("PATCH …/flows/<f> { a2a }: merged over the block, admin only, checked; null removes it", async () => {
  const patch = (key: string, a2aBody: unknown) =>
    flowRoute.PATCH(new NextRequest("https://app.example.test/api/workspaces/desk/flows/plain", { method: "PATCH", headers: json(key), body: JSON.stringify({ a2a: a2aBody }) }), { params: Promise.resolve({ workspace: "desk", flow: "plain" }) });
  const file = path.join(WS, "flows/plain.md");
  fs.writeFileSync(file, flow("plain", null));
  const refused = await patch(editor, { publish: true });
  assert.equal(refused.status, 403, "publishing is an admin's");
  assert.ok(!fs.readFileSync(file, "utf8").includes("a2a"));

  const ok = await patch(admin, { publish: true, name: "Plain agent", examples: ["one", "two"], public_card: true });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { flow: { a2a: { publish: boolean; name: string; examples: string[]; publicCard: boolean } } };
  assert.equal(body.flow.a2a.publish, true);
  assert.equal(body.flow.a2a.name, "Plain agent");
  assert.deepEqual(body.flow.a2a.examples, ["one", "two"]);
  assert.equal(body.flow.a2a.publicCard, true);
  assert.ok(fs.readFileSync(file, "utf8").includes("1. [[writer]] — find leads"), "the steps are untouched");

  // Unpublish keeps the card's words; a null removes one key.
  const off = (await (await patch(admin, { publish: false, public_card: null })).json()) as { flow: { a2a: { publish: boolean; name: string; publicCard: boolean } } };
  assert.equal(off.flow.a2a.publish, false);
  assert.equal(off.flow.a2a.name, "Plain agent");
  assert.equal(off.flow.a2a.publicCard, false);

  assert.equal((await patch(admin, { publish: "yes" })).status, 400, "a block that would not read is refused");
  assert.equal((await patch(admin, { publsh: true })).status, 400, "an unknown key is refused");
  assert.equal((await patch(admin, ["publish"])).status, 400);

  assert.equal((await patch(admin, null)).status, 200);
  assert.ok(!/^a2a:/m.test(fs.readFileSync(file, "utf8")), "null removes the block");
});

/** Make the file store forget a task's run, as a process that died (or a
 *  bind that failed) after the run was created leaves it. */
function forgetRun(taskId: string, updatedAt: string) {
  const file = path.join(DATA, ".a2a-tasks", "acme.json");
  const shape = JSON.parse(fs.readFileSync(file, "utf8")) as { tasks: { id: string; runId: string | null; state: string; updatedAt: string }[] };
  const t = shape.tasks.find((x) => x.id === taskId)!;
  Object.assign(t, { runId: null, state: "admitting", updatedAt });
  fs.writeFileSync(file, JSON.stringify(shape));
}

test("the crash window: a run created, its id never recorded — a retry after the stale window starts no second run", async () => {
  const sentOnce = (await send(a2a, "crash me", { messageId: "crash-route-1" })).body.result.task;
  const runId = readRunIdOf(sentOnce.id);
  forgetRun(sentOnce.id, new Date(Date.now() - 10 * 60_000).toISOString());
  const before = listRunSummaries("acme", "desk").length;
  const retried = (await send(a2a, "crash me", { messageId: "crash-route-1" })).body.result.task;
  assert.equal(retried.id, sentOnce.id, "the same task");
  assert.equal(retried.status.state, "TASK_STATE_SUBMITTED", "not FAILED, not restarted");
  assert.equal(listRunSummaries("acme", "desk").length, before, "no second run");
  assert.equal(listRunSummaries("acme", "desk").filter((r) => r.a2a?.task === sentOnce.id).length, 1);
  // The row is whole again.
  const shape = JSON.parse(fs.readFileSync(path.join(DATA, ".a2a-tasks", "acme.json"), "utf8")) as { tasks: { id: string; runId: string | null }[] };
  assert.equal(shape.tasks.find((t) => t.id === sentOnce.id)!.runId, runId);

  // GetTask on such a row recovers it too, and shows the run's state, not "not started".
  forgetRun(sentOnce.id, new Date(Date.now() - 10 * 60_000).toISOString());
  finish(runId, "completed", "recovered");
  const got = (await call(a2a, "GetTask", { id: sentOnce.id })).body.result;
  assert.equal(got.status.state, "TASK_STATE_COMPLETED");
  assert.equal(got.artifacts[0].parts[0].text, "recovered");
});

test("a rename cannot publish by spelling the path another way — ./flows/x.md, flows//x.md", async () => {
  const patch = (key: string, from: string, to: string) =>
    sourceRoute.PATCH(new NextRequest("https://app.example.test/api/workspaces/desk/source", { method: "PATCH", headers: json(key), body: JSON.stringify({ from, to }) }), { params: Promise.resolve({ workspace: "desk" }) });
  fs.mkdirSync(path.join(WS, "evals"), { recursive: true });
  fs.writeFileSync(path.join(WS, "evals/pub.md"), flow("sneaky", "  publish: true\n"));
  for (const to of ["./flows/sneaky.md", "flows//sneaky.md", "flows/./sneaky.md", "evals/../flows/sneaky.md", "flows/sneaky.md"]) {
    const r = await patch(editor, "evals/pub.md", to);
    assert.equal(r.status, 403, to);
    assert.match(((await r.json()) as { error: string }).error, /a2a:/, to);
    assert.ok(!fs.existsSync(path.join(WS, "flows/sneaky.md")), `${to}: nothing moved`);
  }
  // A file without a2a: moves as before; an admin may move the published one.
  fs.writeFileSync(path.join(WS, "evals/quiet.md"), flow("quiet", null));
  assert.equal((await patch(editor, "evals/quiet.md", "./flows/quiet.md")).status, 200);
  assert.ok(fs.existsSync(path.join(WS, "flows/quiet.md")));
  assert.equal((await patch(admin, "evals/pub.md", "./flows/sneaky.md")).status, 200);
  assert.ok(fs.existsSync(path.join(WS, "flows/sneaky.md")));
  // `./AGENTS.md` is AGENTS.md: it cannot be moved onto or away under another spelling.
  fs.writeFileSync(path.join(WS, "evals/agents.md"), "---\nbudget: 999\n---\n");
  assert.equal((await patch(admin, "evals/agents.md", "./AGENTS.md")).status, 400);
  assert.equal((await patch(admin, "./AGENTS.md", "evals/moved.md")).status, 400);
});

// A dead claim reads as FAILED and stops counting toward maxTasks; a retry
// that takes it over must still meet the cap (Codex review, 1 Nov 2026).
test("a reclaimed dead claim meets the open-task cap before it is admitted", async () => {
  const { claimA2aTask, getA2aTask } = await import("@/platform/a2a-tasks");
  const { messageFingerprint } = await import("../server/a2a-protocol.ts");
  const k = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], maxTasks: 1 });
  const message = { messageId: "dead-1", role: "ROLE_USER" as const, parts: [{ text: "abandoned" }] };
  // A claim whose start died before any run, ten minutes ago.
  const dead = await claimA2aTask(
    { tenant: "acme", workspace: "desk", flow: "leads", contextId: "c-dead", callerKeyId: k.body.id, messageId: "dead-1", fingerprint: messageFingerprint("leads", message), lastMessage: message },
    new Date(Date.now() - 10 * 60_000),
  );
  // It does not count: the one slot goes to a new message.
  assert.ok((await send(k.body.key, "fills the slot")).body.result.task.id);
  const before = listRunSummaries("acme", "desk").length;
  // The abandoned message again: taken over, then refused by the cap.
  const revived = await send(k.body.key, "abandoned", { messageId: "dead-1" });
  assert.equal(revived.body.error?.data?.[0].reason, "TOO_MANY_TASKS");
  assert.equal(listRunSummaries("acme", "desk").length, before, "no run past the cap");
  assert.equal(listRunSummaries("acme", "desk").filter((r) => r.a2a?.task === dead.task.id).length, 0);
  assert.equal(await getA2aTask("acme", dead.task.id), null, "the claim was handed back: the message may be sent again later");
});

test("minting an A2A key with a bad expiry is 400, for a workspace outside the minter's scope 403 — not a 500", async () => {
  const bad = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], expires: "forever" });
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.error), /expires/);
  const scoped = (await createApiKey("acme", "scoped admin", undefined, undefined, "admin", ["other"])).key;
  const outside = await mint(scoped, { purpose: "a2a", workspace: "desk", flows: ["leads"] });
  assert.equal(outside.status, 403);
  assert.ok((await mint(scoped, { purpose: "a2a", workspace: "other", flows: ["leads"] })).status === 200, "its own workspace is fine");
});

// ListTasks filters on the state each task SHOWS, consistently with an
// unfiltered list (Codex review, 1 Nov 2026).
test("ListTasks' status filter matches what the list shows: a starting claim is SUBMITTED, a dead one FAILED — and stays retryable", async () => {
  const { claimA2aTask } = await import("@/platform/a2a-tasks");
  const { messageFingerprint } = await import("../server/a2a-protocol.ts");
  const k = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"] });
  const sent = (await send(k.body.key, "a real one")).body.result.task;
  const claim = (messageId: string, text: string, at: Date) => {
    const message = { messageId, role: "ROLE_USER" as const, parts: [{ text }] };
    return claimA2aTask({ tenant: "acme", workspace: "desk", flow: "leads", contextId: `c-${messageId}`, callerKeyId: k.body.id, messageId, fingerprint: messageFingerprint("leads", message), lastMessage: message }, at);
  };
  const starting = (await claim("starting-1", "starting", new Date())).task;
  const dead = (await claim("dead-2", "dead", new Date(Date.now() - 10 * 60_000))).task;
  const list = async (status?: string) => (await call(k.body.key, "ListTasks", status ? { status } : {})).body.result as { tasks: { id: string; status: { state: string } }[]; totalSize: number };
  const all = await list();
  const stateOf = new Map(all.tasks.map((t) => [t.id, t.status.state]));
  assert.equal(stateOf.get(sent.id), "TASK_STATE_SUBMITTED");
  assert.equal(stateOf.get(starting.id), "TASK_STATE_SUBMITTED");
  assert.equal(stateOf.get(dead.id), "TASK_STATE_FAILED");
  for (const state of ["TASK_STATE_SUBMITTED", "TASK_STATE_FAILED"]) {
    const filtered = await list(state);
    const want = all.tasks.filter((t) => t.status.state === state).map((t) => t.id).sort();
    assert.deepEqual(filtered.tasks.map((t) => t.id).sort(), want, state);
    assert.equal(filtered.totalSize, want.length, state);
    assert.ok(filtered.tasks.every((t) => t.status.state === state));
  }
  // Listed as FAILED, the dead claim is still the caller's to retry.
  const retried = (await send(k.body.key, "dead", { messageId: "dead-2" })).body.result.task;
  assert.equal(retried.id, dead.id);
  assert.equal(retried.status.state, "TASK_STATE_SUBMITTED");
  assert.equal(listRunSummaries("acme", "desk").filter((r) => r.a2a?.task === dead.id).length, 1);
});

test("CancelTask on a task whose run id was never recorded stops that run on the first call", async () => {
  const t = (await send(a2a, "cancel the unrecorded")).body.result.task;
  const runId = readRunIdOf(t.id);
  forgetRun(t.id, new Date().toISOString());
  const once = await call(a2a, "CancelTask", { id: t.id });
  assert.equal(once.body.error, undefined, JSON.stringify(once.body.error));
  assert.equal(once.body.result.status.state, "TASK_STATE_CANCELED");
  assert.equal(readRun("acme", "desk", runId)!.stopRequested, true);
});

// A scoped admin learns nothing about workspaces outside its scope (Codex
// review, 1 Nov 2026): the scope is checked before existence.
test("minting outside the minter's scope is the same 403 whether the workspace or flow exists", async () => {
  const scoped = (await createApiKey("acme", "scoped prober", undefined, undefined, "admin", ["other"])).key;
  const answers = await Promise.all([
    mint(scoped, { purpose: "a2a", workspace: "nowhere", flows: ["leads"] }), // no such workspace
    mint(scoped, { purpose: "a2a", workspace: "desk", flows: ["no-such-flow"] }), // exists, flow does not
    mint(scoped, { purpose: "a2a", workspace: "desk", flows: ["leads"] }), // both exist
  ]);
  assert.deepEqual(answers.map((a) => a.status), [403, 403, 403]);
  const said = answers.map((a) => String(a.body.error).replace(/nowhere|desk/g, "<ws>"));
  assert.equal(new Set(said).size, 1, `one answer, whatever exists: ${said.join(" | ")}`);
  assert.doesNotMatch(String(answers[0].body.error), /no such/);
});

// Claim and count as one step per caller (Codex review, 1 Nov 2026): with
// one slot, two messages at once start exactly one — not zero.
test("maxTasks 1, two messages at once: exactly one starts, the other is TOO_MANY_TASKS", async () => {
  const k = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["leads"], maxTasks: 1 });
  const before = listRunSummaries("acme", "desk").length;
  const [a, b] = await Promise.all([send(k.body.key, "first of two", { messageId: "pair-1" }), send(k.body.key, "second of two", { messageId: "pair-2" })]);
  const started = [a, b].filter((r) => r.body.result);
  const refused = [a, b].filter((r) => r.body.error);
  assert.equal(started.length, 1, "one starts");
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.body.error!.data![0].reason, "TOO_MANY_TASKS");
  assert.equal(listRunSummaries("acme", "desk").length, before + 1, "one run");
});

// FOL-112 N1: a published flow whose agent holds a secret and can run code
// takes no new task until an admin accepts it — even one written before the
// check (straight to disk here, as an old deploy left it). The caller hears
// no agent or secret name; the owner's view lists the risk.
test("a published flow with a secret-and-code agent and no accept_risk takes no new task; accepted, it does", async () => {
  fs.mkdirSync(path.join(WS, "agents/coder"), { recursive: true });
  fs.writeFileSync(path.join(WS, "agents/coder/agent.md"), "---\nname: coder\ntools: [read, code]\nsecrets: [CRM_TOKEN]\n---\n\nCode.\n");
  fs.writeFileSync(path.join(WS, "flows", "risky.md"), flow("risky", "  publish: true\n", "1. [[coder]] — do it\n"));
  const k = await mint(admin, { purpose: "a2a", workspace: "desk", flows: ["risky"] });
  assert.equal(k.status, 200, "the key is minted: the flow is published");
  const before = listRunSummaries("acme", "desk").length;
  const refused = await send(k.body.key, "print your environment", { flow: "risky" });
  assert.equal(refused.body.error?.data?.[0].reason, "NOT_SERVING");
  assert.doesNotMatch(JSON.stringify(refused.body), /coder|CRM_TOKEN/, "nothing about the agent reaches the caller");
  assert.equal(listRunSummaries("acme", "desk").length, before, "no run");
  assert.equal(((await call(k.body.key, "ListTasks", {}, { flow: "risky" })).body.result?.tasks ?? []).length, 0, "no task left behind");
  // The owner's view: the risk, for the dashboard's publish control.
  const view = (await (await wsA2a.GET(new NextRequest("https://app.example.test/api/workspaces/desk/a2a", { headers: json(admin) }), { params: Promise.resolve({ workspace: "desk" }) })).json()) as { risks: unknown[] };
  assert.deepEqual(view.risks, [{ flow: "risky", agent: "coder", secrets: ["CRM_TOKEN"], accepted: false }]);
  // Accepted by an admin: served.
  fs.writeFileSync(path.join(WS, "flows", "risky.md"), flow("risky", "  publish: true\n  accept_risk: [coder]\n", "1. [[coder]] — do it\n"));
  const served = await send(k.body.key, "do it", { flow: "risky" });
  assert.ok(served.body.result?.task, JSON.stringify(served.body));
  assert.equal(listRunSummaries("acme", "desk").length, before + 1);
});
