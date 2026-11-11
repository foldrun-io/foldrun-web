// The platform as an MCP server (1 Nov 2026): POST /api/mcp, end to end
// through the route and the /api routes its tools call. What is held here:
// a key and nothing else opens it (no cookie, no A2A key, no foreign
// Origin); the protocol's handshake, version negotiation, notifications and
// errors; read-only mode; and that every tool answers what its route answers
// to that key — its role and its workspace scope included.
//
// No agent runs (FOLDRUN_DISABLE_WORKER): a started run stays queued.
//
//   node --import ./tests/register.mjs --test tests/mcp-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_PUBLIC_URL = "https://app.example.test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-mcp";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { MCP_TOOLS, MCP_VERSIONS } = await import("../server/mcp.ts");
const route = (await import("../app/api/mcp/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
type Rpc = { jsonrpc: string; id: unknown; result?: any; error?: { code: number; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

function workspace(tenant: string, name: string) {
  const ws = path.join(DATA, tenant, "workspaces", name);
  fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${name}\n---\n`);
  fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
  fs.writeFileSync(path.join(ws, "flows/weekly.md"), "---\nname: weekly\ntrigger: manual\n---\n\n1. [[writer]] — write the weekly note\n");
  fs.writeFileSync(path.join(ws, "flows/daily.md"), "---\nname: daily\ntrigger: manual\n---\n\n1. [[writer]] — write the daily note\n");
}
workspace("acme", "desk");
workspace("acme", "other");
workspace("rival", "desk");

const admin = (await createApiKey("acme", "admin", "ana@acme.test", undefined, "admin")).key;
const viewer = (await createApiKey("acme", "view", undefined, undefined, "viewer")).key;
const scoped = (await createApiKey("acme", "desk only", undefined, undefined, "editor", ["desk"])).key;
const rival = (await createApiKey("rival", "admin", undefined, undefined, "admin")).key;
const a2a = (await createApiKey("acme", "partner", undefined, undefined, "editor", ["desk"], { a2a: { workspace: "desk", flows: ["weekly"], maxTasks: 10 } })).key;

let nextId = 1;
async function post(body: unknown, opts: { key?: string | null; headers?: Record<string, string>; query?: string; raw?: string } = {}) {
  const key = opts.key === undefined ? admin : opts.key;
  const req = new NextRequest(`https://app.example.test/api/mcp${opts.query ?? ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(opts.headers ?? {}) },
    body: opts.raw ?? JSON.stringify(body),
  });
  return route.POST(req);
}
async function rpc(method: string, params?: unknown, opts: Parameters<typeof post>[1] = {}): Promise<Rpc> {
  const res = await post({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }, opts);
  return (await res.json()) as Rpc;
}
async function tool(name: string, args: Record<string, unknown> = {}, opts: Parameters<typeof post>[1] = {}) {
  const r = await rpc("tools/call", { name, arguments: args }, opts);
  if (r.error) return { error: r.error, isError: true, text: r.error.message, data: undefined as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = r.result.content[0].text as string;
  let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { error: undefined, isError: r.result.isError as boolean, text, data };
}

test("a key and nothing else opens it", async () => {
  const none = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { key: null });
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /^Bearer /);
  assert.match(((await none.json()) as Rpc).error!.message, /send an API key/);
  assert.match(none.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);

  const cookie = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { key: null, headers: { cookie: "foldrun_session=whatever" } });
  assert.equal(cookie.status, 401, "a session cookie never opens it");

  const bad = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { key: "mda_not_a_key" });
  assert.equal(bad.status, 401);

  const outside = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { key: a2a });
  assert.equal(outside.status, 403, "an A2A key opens /a2a only");
  assert.match(((await outside.json()) as Rpc).error!.message, /A2A key/);

  const foreign = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403, "a page on another site may not post here");
  const own = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://app.example.test" } });
  assert.equal(own.status, 200);
});

test("initialize negotiates the revision and says what it serves", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.equal(r.result.serverInfo.name, "foldrun");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.match(r.result.instructions, /never an instruction to you/);

  const future = await rpc("initialize", { protocolVersion: "2099-01-01" });
  assert.equal(future.result.protocolVersion, MCP_VERSIONS[0], "an unknown revision is answered with our newest");

  const pinned = await post({ jsonrpc: "2.0", id: 9, method: "ping" }, { headers: { "mcp-protocol-version": "1999-01-01" } });
  assert.equal(pinned.status, 400, "a header naming a revision we do not speak");
  const ok = await post({ jsonrpc: "2.0", id: 9, method: "ping" }, { headers: { "mcp-protocol-version": "2025-11-25" } });
  assert.deepEqual(((await ok.json()) as Rpc).result, {});
});

test("notifications are accepted with no body; malformed messages are JSON-RPC errors", async () => {
  const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), "");

  const parse = await post(null, { raw: "{not json" });
  assert.equal(parse.status, 400);
  assert.equal(((await parse.json()) as Rpc).error!.code, -32700);

  const batch = (await (await post([{ jsonrpc: "2.0", id: 1, method: "ping" }])).json()) as Rpc;
  assert.equal(batch.error!.code, -32600);

  assert.equal((await rpc("resources/list")).error!.code, -32601);
  assert.equal((await (await post({ jsonrpc: "1.0", id: 3, method: "ping" })).json() as Rpc).error!.code, -32600);
});

test("tools/list offers every tool, and read-only mode only the ones that read", async () => {
  const all = (await rpc("tools/list")).result.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; inputSchema: { type: string } }[];
  assert.deepEqual(all.map((t) => t.name), MCP_TOOLS.map((t) => t.name));
  for (const t of all) assert.equal(t.inputSchema.type, "object");
  assert.equal(all.find((t) => t.name === "stop_run")!.annotations.destructiveHint, true);
  assert.equal(all.find((t) => t.name === "inbox")!.annotations.readOnlyHint, true);

  const reads = (await rpc("tools/list", undefined, { query: "?readonly=1" })).result.tools as { name: string }[];
  assert.deepEqual(reads.map((t) => t.name), MCP_TOOLS.filter((t) => t.read).map((t) => t.name));
  assert.ok(!reads.some((t) => t.name === "run_flow"));

  const refused = await tool("run_flow", { workspace: "desk", flow: "weekly" }, { query: "?readonly=1" });
  assert.equal(refused.error?.code, -32602);
  assert.match(refused.text, /read-only/);
});

test("arguments are checked against the tool's schema before any route runs", async () => {
  assert.equal((await tool("nope")).error?.code, -32602);
  assert.match((await tool("get_run", { workspace: "desk" })).text, /`run_id` is required/);
  assert.match((await tool("list_runs", { workspace: "desk", limit: "ten" })).text, /whole number/);
  assert.match((await tool("decide_approval", { workspace: "desk", run_id: "r", decision: "maybe" })).text, /one of approve, reject/);
  assert.match((await tool("whoami", { extra: 1 })).text, /takes no `extra`/);
});

test("the read tools answer what their routes answer to this key", async () => {
  const me = await tool("whoami");
  assert.equal(me.isError, false);
  assert.equal(me.data.account, "acme");

  const all = await tool("list_workspaces");
  assert.deepEqual(all.data.workspaces.map((w: { name: string }) => w.name).sort(), ["desk", "other"]);
  const narrow = await tool("list_workspaces", {}, { key: scoped });
  assert.deepEqual(narrow.data.workspaces.map((w: { name: string }) => w.name), ["desk"], "a scoped key sees its workspaces only");

  const flows = await tool("list_flows", { workspace: "desk" });
  assert.equal(flows.isError, false);
  assert.ok(JSON.stringify(flows.data).includes("weekly"));

  const file = await tool("read_file", { workspace: "desk", path: "flows/weekly.md" });
  assert.equal(file.isError, false);
  assert.match(file.data.content, /write the weekly note/);

  const outOfScope = await tool("read_file", { workspace: "other", path: "flows/weekly.md" }, { key: scoped });
  assert.equal(outOfScope.isError, true);
  assert.match(outOfScope.text, /^HTTP 403: .*not one you were given/);

  const rivalRead = await tool("read_file", { workspace: "desk", path: "flows/weekly.md" }, { key: rival });
  assert.equal(rivalRead.isError, false, "rival's own desk");
  assert.doesNotMatch(rivalRead.text, /acme/);

  const inbox = await tool("inbox", { bucket: "all" });
  assert.equal(inbox.isError, false, inbox.text);
  assert.equal(inbox.data.person, "ana@acme.test", "the inbox of the person who minted the key");
  const nobody = await tool("inbox", {}, { key: viewer });
  assert.equal(nobody.isError, true);
  assert.match(nobody.text, /^HTTP 400: this key was not minted by a person/, "the route's own refusal, word for word");
  assert.ok(Array.isArray(inbox.data.items));
  const approvals = await tool("list_approvals");
  assert.equal(approvals.isError, false);
});

test("the tools that act go through their routes: role, scope and state hold", async () => {
  const viewerRun = await tool("run_flow", { workspace: "desk", flow: "weekly", task: "x" }, { key: viewer });
  assert.equal(viewerRun.isError, true);
  assert.match(viewerRun.text, /^HTTP 403/, "a viewer's key may not start a run");

  const started = await tool("run_flow", { workspace: "desk", flow: "weekly", task: "write this week's note", test: true });
  assert.equal(started.isError, false, started.text);
  const runId = started.data.runId as string;
  assert.ok(runId);
  await tool("run_flow", { workspace: "desk", flow: "daily" });

  const one = await tool("get_run", { workspace: "desk", run_id: runId });
  assert.equal(one.isError, false);
  assert.equal(one.data.id ?? one.data.run?.id, runId);

  const weekly = await tool("list_runs", { workspace: "desk", flow: "weekly" });
  assert.ok(weekly.data.runs.length >= 1);
  assert.ok(weekly.data.runs.every((r: { flow: string }) => r.flow === "weekly"), "the flow filter keeps that flow's runs");
  const limited = await tool("list_runs", { workspace: "desk", limit: 1 });
  assert.equal(limited.data.runs.length, 1);

  const elsewhere = await tool("get_run", { workspace: "desk", run_id: runId }, { key: rival });
  assert.equal(elsewhere.isError, true, "another account's run is not found");

  const notRunning = await tool("message_run", { workspace: "desk", run_id: runId, text: "hello" });
  assert.equal(notRunning.isError, true);
  assert.match(notRunning.text, /^HTTP 409/);

  const noQuestion = await tool("answer_question", { workspace: "desk", run_id: runId, question: "q-nope", answer: "yes" });
  assert.equal(noQuestion.isError, true);

  const noGate = await tool("decide_approval", { workspace: "desk", run_id: runId, decision: "approve" });
  assert.equal(noGate.isError, true, "nothing is waiting on a person");

  // A client that retries a lost answer with the same Idempotency-Key starts one run.
  const once = { headers: { "idempotency-key": "mcp-retry-1" } };
  const first = await tool("run_flow", { workspace: "desk", flow: "daily", task: "once" }, once);
  const again = await tool("run_flow", { workspace: "desk", flow: "daily", task: "once" }, once);
  assert.equal(first.isError, false, first.text);
  assert.equal(again.data.runId, first.data.runId, "the retry answers the run it already started");

  const viewerStop = await tool("stop_run", { workspace: "desk", run_id: runId }, { key: viewer });
  assert.equal(viewerStop.isError, true);
  const stopped = await tool("stop_run", { workspace: "desk", run_id: runId });
  assert.equal(stopped.isError, false, stopped.text);
});

test("run_agent runs one agent on a task of the caller's; list_agents names them — role, scope and read-only mode hold", async () => {
  const listed = await tool("list_agents", { workspace: "desk" });
  assert.equal(listed.isError, false, listed.text);
  assert.ok(listed.data.agents.some((a: { name: string }) => a.name === "writer"), "the agent is listed");

  const names = ((await rpc("tools/list", undefined, { query: "?readonly=1" })).result.tools as { name: string }[]).map((t) => t.name);
  assert.ok(names.includes("list_agents"), "listing reads");
  assert.ok(!names.includes("run_agent"), "running acts: not in read-only mode");

  const viewerRun = await tool("run_agent", { workspace: "desk", agent: "writer", task: "x" }, { key: viewer });
  assert.equal(viewerRun.isError, true);
  assert.match(viewerRun.text, /^HTTP 403/, "a viewer's key may not start a run");

  const missing = await tool("run_agent", { workspace: "desk", agent: "nobody", task: "x" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /^HTTP 404/);
  const escape = await tool("run_agent", { workspace: "desk", agent: "../../rival/workspaces/desk/agents/writer", task: "x" });
  assert.equal(escape.isError, true, "an agent is one folder, never a path");

  const scopedRun = await tool("run_agent", { workspace: "other", agent: "writer", task: "x" }, { key: scoped });
  assert.equal(scopedRun.isError, true, "a key scoped to desk cannot run other's agents");

  const started = await tool("run_agent", { workspace: "desk", agent: "writer", task: "draft a two-line note", test: true });
  assert.equal(started.isError, false, started.text);
  const runId = started.data.runId as string;
  assert.ok(runId, "a receipt at once");
  assert.equal(started.data.test, true);
  const one = await tool("get_run", { workspace: "desk", run_id: runId });
  assert.equal(one.isError, false);
  assert.equal(one.data.id ?? one.data.run?.id, runId, "get_run reads it");
});

test("run_agent passes a snapshot through to the route, which refuses one this install cannot hold", async () => {
  const bad = await tool("run_agent", { workspace: "desk", agent: "writer", task: "fix", snapshot: "nope" });
  assert.equal(bad.isError, true, bad.text);
  assert.match(bad.text, /^HTTP 400[\s\S]*64 hex/, "the id reached the route");
  const prev = process.env.FOLDRUN_RUN_ISOLATION;
  delete process.env.FOLDRUN_RUN_ISOLATION;
  try {
    const none = await tool("run_agent", { workspace: "desk", agent: "writer", task: "fix", snapshot: "c".repeat(64) });
    assert.equal(none.isError, true);
    assert.match(none.text, /^HTTP 409/);
  } finally {
    if (prev !== undefined) process.env.FOLDRUN_RUN_ISOLATION = prev;
  }
});

test("authoring: create_workspace, write_file, check_workspace, delete_file — through their routes, with role, scope, checks and read-only mode", async () => {
  const reads = ((await rpc("tools/list", undefined, { query: "?readonly=1" })).result.tools as { name: string }[]).map((t) => t.name);
  assert.ok(reads.includes("check_workspace"), "checking reads");
  for (const t of ["create_workspace", "write_file", "delete_file"]) assert.ok(!reads.includes(t), `${t} acts: not in read-only mode`);
  const all = (await rpc("tools/list")).result.tools as { name: string; annotations: { destructiveHint: boolean } }[];
  assert.equal(all.find((t) => t.name === "delete_file")!.annotations.destructiveHint, true);

  // Create: blank, and never over a workspace that is there.
  const made = await tool("create_workspace", { name: "built" });
  assert.equal(made.isError, false, made.text);
  assert.ok(fs.existsSync(path.join(DATA, "acme", "workspaces", "built", "AGENTS.md")), "a blank workspace with its AGENTS.md");
  const taken = await tool("create_workspace", { name: "desk" });
  assert.match(taken.text, /^HTTP 409/, "an existing workspace is never deployed over");
  assert.equal(fs.readFileSync(path.join(DATA, "acme", "workspaces", "desk", "agents/writer/agent.md"), "utf8").includes("Write."), true);
  assert.match((await tool("create_workspace", { name: "v-made" }, { key: viewer })).text, /^HTTP 403/);

  // Write: an agent and a flow, live at once.
  const agent = await tool("write_file", { workspace: "built", path: "agents/greeter/agent.md", content: "---\nname: greeter\ndescription: greets\n---\n\nSay hello.\n", message: "first agent", if_match: "absent" });
  assert.equal(agent.isError, false, agent.text);
  assert.match(agent.data.sha256, /^[0-9a-f]{64}$/);
  const flow = await tool("write_file", { workspace: "built", path: "flows/hello.md", content: "---\ntrigger: manual\n---\n\n1. [[greeter]] — say hello\n" });
  assert.equal(flow.isError, false, flow.text);
  const flows = await tool("list_flows", { workspace: "built" });
  assert.ok(JSON.stringify(flows.data).includes("hello"), "the flow is there to run, with no deploy");

  // A file with an error is refused and nothing is written.
  const bad = await tool("write_file", { workspace: "built", path: "flows/broken.md", content: "---\ntrigger: manual\n---\n\n1. [[nobody-here]] — x\n" });
  assert.equal(bad.isError, true, bad.text);
  assert.match(bad.text, /^HTTP 422/);
  assert.equal(fs.existsSync(path.join(DATA, "acme", "workspaces", "built", "flows/broken.md")), false, "nothing written");
  assert.match(bad.text, /issues: \[/, "the refusal carries its issues");
  assert.match(bad.text, /nobody-here/, "naming what is wrong");

  // An empty file is a real write.
  const empty = await tool("write_file", { workspace: "built", path: "scripts/empty.sh", content: "" });
  assert.equal(empty.isError, false, empty.text);
  assert.equal(fs.readFileSync(path.join(DATA, "acme", "workspaces", "built", "scripts/empty.sh"), "utf8").trim(), "", "saved empty (the store ends a file with a newline)");
  assert.match((await tool("write_file", { workspace: "built", path: "", content: "x" })).text, /`path` is required/, "but an empty path is not");

  // if_match: a stale sha is refused; "absent" refuses a file that is there.
  const stale = await tool("write_file", { workspace: "built", path: "agents/greeter/agent.md", content: "---\nname: greeter\n---\n\nHi.\n", if_match: "0".repeat(64) });
  assert.match(stale.text, /^HTTP 409/);
  const exists = await tool("write_file", { workspace: "built", path: "agents/greeter/agent.md", content: "x", if_match: "absent" });
  assert.match(exists.text, /^HTTP 409/);
  const fresh = await tool("write_file", { workspace: "built", path: "agents/greeter/agent.md", content: "---\nname: greeter\ndescription: greets warmly\n---\n\nSay hello warmly.\n", if_match: agent.data.sha256 });
  assert.equal(fresh.isError, false, fresh.text);

  // Role and scope are the route's.
  assert.match((await tool("write_file", { workspace: "built", path: "knowledge/x.md", content: "x" }, { key: viewer })).text, /^HTTP 403/);
  assert.equal((await tool("write_file", { workspace: "other", path: "knowledge/x.md", content: "x" }, { key: scoped })).isError, true, "a key scoped to desk cannot write other");
  assert.equal((await tool("write_file", { workspace: "desk", path: "knowledge/x.md", content: "x" }, { key: rival })).isError, true, "another account's workspace is not reached");
  assert.equal((await tool("write_file", { workspace: "built", path: "../desk/AGENTS.md", content: "x" })).isError, true, "a path never leaves its workspace");

  // Check: findings with rule ids.
  const checked = await tool("check_workspace", { workspace: "built" });
  assert.equal(checked.isError, false, checked.text);
  assert.ok(Array.isArray(checked.data.findings));
  assert.equal(checked.data.findings.filter((f: { level: string }) => f.level === "error").length, 0, JSON.stringify(checked.data.findings));
  assert.match((await tool("check_workspace", { workspace: "nope" })).text, /^HTTP 404/);

  // Delete: gone from the folder, kept in history.
  assert.match((await tool("delete_file", { workspace: "built", path: "flows/hello.md" }, { key: viewer })).text, /^HTTP 403/);
  const gone = await tool("delete_file", { workspace: "built", path: "flows/hello.md" });
  assert.equal(gone.isError, false, gone.text);
  assert.equal(fs.existsSync(path.join(DATA, "acme", "workspaces", "built", "flows/hello.md")), false);
});

test("run_agent and run_flow carry a context to their routes (FOL-162), which check it", async () => {
  const a = await tool("run_agent", { workspace: "desk", agent: "writer", task: "draft", test: true, context: "chat-7" });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.data.context, "chat-7");
  const one = await tool("get_run", { workspace: "desk", run_id: a.data.runId });
  assert.equal((one.data.context ?? one.data.run?.context).id, "chat-7");
  assert.equal((one.data.input ?? one.data.run?.input).text, "draft");
  const f = await tool("run_flow", { workspace: "desk", flow: "weekly", task: "x", test: true, context: "chat-7" });
  assert.equal(f.isError, false, f.text);
  assert.equal(f.data.context, "chat-7");
  const listed = await tool("list_runs", { workspace: "desk", limit: 100 });
  assert.ok(listed.data.runs.some((r: { id: string; context?: { id: string } }) => r.id === f.data.runId && r.context?.id === "chat-7"), "the list shows it");
  const bad = await tool("run_agent", { workspace: "desk", agent: "writer", task: "x", context: "has a space" });
  assert.match(bad.text, /^HTTP 400: context is 1–200 printable ASCII/);
});
