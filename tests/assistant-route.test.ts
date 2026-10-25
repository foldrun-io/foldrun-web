// POST …/assistant with the model replaced by a script that drives the real
// tools: the docs are searchable and readable, the workspace is readable but
// only its source, proposals outside agents/flows/tools/skills are refused,
// a frontmatter key the docs never name and a value shaped like a secret are
// errors, the unsaved proposals ride the conversation, nothing is written to
// the workspace, a viewer is refused before any model is called, and the
// streamed form says what it reads, the words, then the result.
//
//   node --import ./tests/register.mjs --test tests/assistant-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-assistant-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DRAFT_MOCK;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
// No worker tier here: the route runs each reply in this process.
process.env.FOLDRUN_ASSISTANT_INLINE = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const assistant = await import("../server/assistant.ts");
const docs = await import("../server/assistant-docs.ts");
const route = (await import("../app/api/workspaces/[workspace]/assistant/route.ts")) as {
  POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
};
const source = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as {
  PUT: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.mkdirSync(path.join(ws, "state"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: Writes drafts.\n---\n\nWrite.\n");
fs.writeFileSync(path.join(ws, "flows/publish.md"), "---\nname: publish\n---\n\n1. [[writer]] — Write it.\n");
fs.writeFileSync(path.join(ws, "state/cursor.json"), '{"secret":"state"}');
fs.writeFileSync(path.join(ws, "secrets.json"), '{"KEY":"value"}');
fs.mkdirSync(path.join(DATA, TENANT, "library/skills/tone"), { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "library/skills/tone/SKILL.md"), "---\nname: tone\ndescription: Our tone.\n---\n\nBe brief.\n");

const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const ctx = { params: Promise.resolve({ workspace: WS }) };
const post = (body: unknown, opts: { key?: string; stream?: boolean } = {}) =>
  route.POST(
    new NextRequest(`http://localhost/api/workspaces/${WS}/assistant`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.key ?? editor}`,
        "content-type": "application/json",
        ...(opts.stream ? { accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
    }),
    ctx,
  );
const ask = (content: string, extra: Record<string, unknown> = {}) => post({ messages: [{ role: "user", content }], ...extra });

const snapshot = () => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(ws, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(ws);
  return out;
};

type Tool = { name: string; run: (a: Record<string, string | undefined>) => Promise<string> | string };
const call = async (tools: Tool[], name: string, args: Record<string, string> = {}) => String(await tools.find((t) => t.name === name)!.run(args));

const SKILL = "---\nname: pacing\ndescription: Check whether spend is pacing to budget. Use when asked if spend is on track.\n---\n\nCompare spend to budget and say ON TRACK or OVER.\n";

test("the docs: the customer set only, searchable, readable by section", () => {
  const all = docs.assistantDocs();
  assert.ok(all, "the sibling foldrun-docs is read in tests");
  assert.ok(all!["flows.md"] && all!["agents.md"] && all!["tools.md"]);
  assert.equal(all!["environment.md"], undefined, "the platform's environment is not a customer doc");
  assert.ok(!Object.keys(all!).some((f) => f.endsWith("-adr.md")), "no design records");
  assert.ok(!/^## Super admin/m.test(all!["api.md"] ?? ""), "no operator routes");
  const hits = docs.searchDocs("SKILL.md skill description");
  assert.ok(hits.some((h) => h.doc === "tools" && /Skills/.test(h.section)), JSON.stringify(hits.map((h) => h.section)));
  const r = docs.readDoc("tools", "Skills — procedure, not capability");
  assert.ok(r.ok && /SKILL\.md/.test(r.text) && r.url === "/dashboard/docs/tools#skills-procedure-not-capability");
  assert.equal(docs.readDoc("nonsense", undefined).ok, false);
  const names = docs.documentedNames();
  for (const k of ["model", "tools", "on-fail", "transport", "run", "args", "skills"]) assert.ok(names.has(k), k);
  assert.ok(!names.has("temperature_boost"));
});

test("a viewer is refused before any model is called", async () => {
  let called = false;
  assistant.setAssistantRunner(async () => {
    called = true;
    return { text: "", costUsd: 0, supply: "mock" };
  });
  const res = await post({ messages: [{ role: "user", content: "make me an agent" }] }, { key: viewer });
  assert.equal(res.status, 403);
  assert.equal(called, false);
});

test("the request is bounded and shaped", async () => {
  assistant.setAssistantRunner(async () => ({ text: "ok", costUsd: 0, supply: "mock" }));
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ messages: [{ role: "assistant", content: "hi" }] })).status, 400);
  assert.equal((await ask("x".repeat(assistant.ASSISTANT_LIMITS.message + 1))).status, 413);
  assert.equal((await ask("hi", { files: [{ path: "AGENTS.md", content: "x" }] })).status, 400);
  const many = Array.from({ length: assistant.ASSISTANT_LIMITS.requestMessages + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
  many[many.length - 1] = { role: "user", content: "x" };
  assert.equal((await post({ messages: many })).status, 413);
  assert.equal((await post({ messages: [{ role: "user", content: "x".repeat(assistant.ASSISTANT_LIMITS.requestMessageChars + 1) }, { role: "assistant", content: "a" }, { role: "user", content: "b" }] })).status, 413);
  assert.equal(assistant.paidByPlatform(TENANT, WS), false, "a stand-in model is never the platform's pool");
});

test("reads the workspace's source and the library, never state, secrets or a path out", async () => {
  let seen: Record<string, string> = {};
  assistant.setAssistantRunner(async ({ tools }) => {
    seen = {
      list: await call(tools, "list_workspace"),
      agent: await call(tools, "read_workspace_file", { path: "agents/writer/agent.md" }),
      lib: await call(tools, "read_workspace_file", { path: "library/skills/tone/SKILL.md" }),
      state: await call(tools, "read_workspace_file", { path: "state/cursor.json" }),
      secrets: await call(tools, "read_workspace_file", { path: "secrets.json" }),
      out: await call(tools, "read_workspace_file", { path: "../../../acme/secrets.json" }),
      outLib: await call(tools, "read_workspace_file", { path: "library/skills/../../workspaces/desk/secrets.json" }),
    };
    return { text: "read", costUsd: 0, supply: "mock" };
  });
  const res = await ask("what agents do I have?");
  assert.equal(res.status, 200);
  assert.match(seen.list, /agents\/writer\/agent\.md/);
  assert.match(seen.list, /library\/skills\/tone\/SKILL\.md/);
  assert.doesNotMatch(seen.list, /state\/|secrets\.json/);
  assert.match(seen.agent, /Writes drafts/);
  assert.match(seen.lib, /Be brief/);
  for (const k of ["state", "secrets", "out", "outLib"]) assert.match(seen[k], /not a file you can read/, k);
});

test("proposes only the four kinds, checks each, and writes nothing", async () => {
  const before = snapshot();
  const verdicts: Record<string, string> = {};
  assistant.setAssistantRunner(async ({ tools, onText }) => {
    await call(tools, "search_docs", { query: "skills SKILL.md" });
    await call(tools, "read_doc", { doc: "agents" });
    verdicts.agentsMd = await call(tools, "propose_file", { path: "AGENTS.md", content: "---\nname: desk\n---\n" });
    verdicts.knowledge = await call(tools, "propose_file", { path: "knowledge/facts.md", content: "x" });
    verdicts.invented = await call(tools, "propose_file", {
      path: "agents/pacer/agent.md",
      content: "---\nname: pacer\ndescription: Checks pacing.\ntemperature_boost: 3\n---\n\nCheck pacing.\n",
    });
    verdicts.secret = await call(tools, "propose_file", {
      path: "agents/leaky/agent.md",
      content: "---\nname: leaky\n---\n\nUse the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA to call it.\n",
    });
    await call(tools, "drop_file", { path: "agents/leaky/agent.md" });
    verdicts.fixed = await call(tools, "propose_file", {
      path: "agents/pacer/agent.md",
      content: "---\nname: pacer\ndescription: Checks pacing.\nskills: [pacing]\n---\n\nCheck pacing with the pacing skill.\n",
    });
    verdicts.skill = await call(tools, "propose_file", { path: "skills/pacing/SKILL.md", content: SKILL });
    verdicts.badSkill = await call(tools, "propose_file", { path: "skills/other/SKILL.md", content: "---\nname: wrong\n---\n\n" });
    await call(tools, "drop_file", { path: "skills/other/SKILL.md" });
    verdicts.tool = await call(tools, "propose_file", {
      path: "tools/csv-sum/tool.md",
      content: "---\ntransport: script\nname: csv-sum\nrun: run.py\ndescription: Sum a CSV column. Use when a total is needed.\nargs:\n  file: the CSV path\n---\n",
    });
    verdicts.program = await call(tools, "propose_file", { path: "tools/csv-sum/run.py", content: "import sys\nprint(sum(1 for _ in open(sys.argv[1])))\n" });
    onText("Done.");
    return { text: "I proposed a pacing agent, its skill and a tool [tools › Skills — procedure, not capability].", costUsd: 0, supply: "mock" };
  });
  const res = await ask("add an agent that checks ad pacing, with a skill and a csv tool");
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    reply: string;
    files: { path: string; content: string; before: string | null; sha256: string | null }[];
    issues: { where: string; message: string; level: string }[];
    sources: { doc: string; url: string }[];
  };
  assert.match(verdicts.agentsMd, /refused/);
  assert.match(verdicts.knowledge, /refused/);
  assert.match(verdicts.invented, /temperature_boost:` appears nowhere in the foldrun docs/);
  assert.match(verdicts.secret, /looks like an Anthropic key/);
  assert.match(verdicts.badSkill, /name: wrong does not match its folder|needs description/);
  assert.match(verdicts.tool, /there is no tools\/csv-sum\/run\.py/);
  assert.match(verdicts.program, /check passes/i, verdicts.program);
  assert.deepEqual(body.files.map((f) => f.path).sort(), ["agents/pacer/agent.md", "skills/pacing/SKILL.md", "tools/csv-sum/run.py", "tools/csv-sum/tool.md"]);
  assert.ok(body.files.every((f) => f.before === null && f.sha256 === null));
  assert.deepEqual(body.issues.filter((i) => i.level === "error"), [], JSON.stringify(body.issues));
  assert.equal(body.ok, true);
  assert.ok(body.sources.some((s) => s.doc === "agents"));
  assert.ok(body.sources.every((s) => s.url.startsWith("/dashboard/docs/")));
  assert.deepEqual(snapshot(), before, "an assistant reply writes nothing");
});

test("the unsaved proposals ride the conversation; one already saved drops away", async () => {
  let prompt = "";
  let read = "";
  assistant.setAssistantRunner(async ({ prompt: p, tools }) => {
    prompt = p;
    read = await call(tools, "read_workspace_file", { path: "skills/pacing/SKILL.md" });
    return { text: "Still there.", costUsd: 0, supply: "mock" };
  });
  const saved = fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8");
  const res = await post({
    messages: [
      { role: "user", content: "make a skill" },
      { role: "assistant", content: "Proposed skills/pacing/SKILL.md." },
      { role: "user", content: "is it still there?" },
    ],
    files: [
      { path: "skills/pacing/SKILL.md", content: SKILL },
      { path: "agents/writer/agent.md", content: saved },
    ],
    page: "flows",
  });
  const body = (await res.json()) as { files: { path: string }[] };
  assert.match(prompt, /<unsaved>[\s\S]*skills\/pacing\/SKILL\.md/);
  assert.match(prompt, /<conversation>[\s\S]*make a skill[\s\S]*<\/conversation>/);
  assert.match(prompt, /looking at: flows/);
  assert.match(read, /state="proposed"/);
  assert.deepEqual(body.files.map((f) => f.path), ["skills/pacing/SKILL.md"]);
});

test("streams what it reads, the words, then the result", async () => {
  assistant.setAssistantRunner(async ({ tools, onText }) => {
    await call(tools, "search_docs", { query: "when rows of" });
    onText("Use ");
    onText("`when: rows of`.");
    return { text: "Use `when: rows of`.", costUsd: 0, supply: "mock" };
  });
  const res = await post({ messages: [{ role: "user", content: "skip a step when the csv is empty?" }] }, { stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await res.text();
  const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  assert.equal(events[0], "status");
  assert.ok(events.includes("text"));
  assert.equal(events[events.length - 1], "done");
  assert.match(text, /Searching the docs/);
  assert.match(text, /"reply":"Use `when: rows of`\."/);
});

test("the system prompt holds the scope, the docs rule and the docs' outline", () => {
  const s = assistant.assistantSystem(WS);
  assert.match(s, /only help with building on foldrun/);
  assert.match(s, /only source about foldrun/);
  assert.match(s, /Never invent a field/);
  assert.match(s, /- flows \(Flows\): /);
  assert.match(s, /- tools \(/);
  assert.doesNotMatch(s, /- environment \(/);
});

test("history is trimmed newest first and starts with the person", () => {
  const long = "x".repeat(assistant.ASSISTANT_LIMITS.history);
  const kept = assistant.trimHistory([
    { role: "user", content: long },
    { role: "assistant", content: "a" },
    { role: "user", content: "b" },
  ]);
  assert.deepEqual(kept.map((m) => m.content), ["b"]);
});

test("every kind of file it may propose is one the source PUT will save", async () => {
  const files = [
    { path: "agents/saver/agent.md", content: "---\nname: saver\ndescription: Saves.\n---\n\nSave.\n" },
    { path: "flows/saved.md", content: "---\nname: saved\n---\n\n1. [[saver]] — Save it.\n" },
    { path: "skills/kept/SKILL.md", content: "---\nname: kept\ndescription: Kept. Use when keeping.\n---\n\nKeep.\n" },
    { path: "skills/kept/scripts/keep.py", content: "print('kept')\n" },
    { path: "skills/kept/references/notes.md", content: "notes\n" },
    { path: "tools/sum-it/tool.md", content: "---\ntransport: script\nname: sum-it\nrun: run.py\ndescription: Sums. Use for totals.\n---\n" },
    { path: "tools/sum-it/run.py", content: "print(1)\n" },
    { path: "tools/sum-it/requirements.txt", content: "pandas\n" },
    { path: "tools/one-file.md", content: "---\nname: one-file\nurl: https://api.example.com/x\ndescription: One. Use for one.\n---\n" },
  ];
  for (const f of files) assert.ok(assistant.kindOf(f.path), f.path);
  assert.deepEqual(assistant.checkProposals(TENANT, WS, files).filter((i) => i.level === "error"), []);
  for (const f of files) {
    const res = await source.PUT(
      new NextRequest(`http://localhost/api/workspaces/${WS}/source`, {
        method: "PUT",
        headers: { authorization: `Bearer ${editor}`, "content-type": "application/json" },
        body: JSON.stringify({ path: f.path, content: f.content, message: "written with the assistant: test", ifMatch: null }),
      }),
      ctx,
    );
    assert.equal(res.status, 200, `${f.path}: ${await res.text()}`);
    assert.equal(fs.readFileSync(path.join(ws, f.path), "utf8"), f.content);
  }
});

test("on the platform's models a reply is charged like a run's tokens, and says what it used", async () => {
  const { readLedger } = await import("@/platform/ledger");
  const { billing } = await import("@/platform/billing");
  const before = (await readLedger(TENANT)).length;
  assistant.setAssistantRunner(async () => ({
    text: "Answered.",
    costUsd: 0.25,
    supply: "platform",
    usage: { inputTokens: 12_000, outputTokens: 800, costUsd: 0.25 },
  }));
  const res = await ask("how do flows work?");
  const body = (await res.json()) as { chargedUsd: number | null; usage: { inputTokens: number; outputTokens: number } | null };
  const entries = await readLedger(TENANT);
  const line = entries.slice(before).find((e) => e.flow === "ai-assistant");
  assert.ok(line, "one ledger line, flow ai-assistant");
  assert.equal(line!.workspace, WS);
  assert.ok(line!.usd < 0, "charged, not free");
  assert.equal(-line!.usd, billing().price({ tokenCostUsd: 0.25, steps: 0, computeSecs: 0 }).totalUsd, "the same price a run's tokens get");
  assert.equal(body.chargedUsd, -line!.usd);
  assert.deepEqual(body.usage, { inputTokens: 12_000, outputTokens: 800, costUsd: 0.25 });

  // The account's own provider or key: its provider bills it, not the platform.
  assistant.setAssistantRunner(async () => ({ text: "Answered.", costUsd: 0.25, supply: "provider" }));
  const own = (await (await ask("again")).json()) as { chargedUsd: number | null };
  assert.equal(own.chargedUsd, null);
  assert.equal((await readLedger(TENANT)).filter((e) => e.flow === "ai-assistant").length, 1);
});

test("proposes a new workspace only under a free, well-formed name", async () => {
  const verdicts: string[] = [];
  assistant.setAssistantRunner(async ({ tools }) => {
    verdicts.push(await call(tools, "propose_workspace", { name: WS, purpose: "x" }));
    verdicts.push(await call(tools, "propose_workspace", { name: "Ads Desk", purpose: "x" }));
    verdicts.push(await call(tools, "propose_workspace", { name: "ads-desk", purpose: "Runs  the ad\naccounts." }));
    return { text: "Create ads-desk, then I write its files there.", costUsd: 0, supply: "mock" };
  });
  const body = (await (await ask("set up a separate desk for ads")).json()) as { workspace: { name: string; purpose: string } | null };
  assert.match(verdicts[0], /exists/);
  assert.match(verdicts[1], /refused/);
  assert.match(verdicts[2], /proposed/);
  assert.deepEqual(body.workspace, { name: "ads-desk", purpose: "Runs the ad accounts." });
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "ads-desk")), false, "proposing creates nothing");
});

test("POST /api/workspaces with ifAbsent refuses a name that exists, and never deploys over it", async () => {
  const workspaces = (await import("../app/api/workspaces/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
  const create = (name: string) =>
    workspaces.POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
        body: JSON.stringify({ name, template: true, ifAbsent: true }),
      }),
    );
  const before = snapshot();
  const taken = await create(WS);
  assert.equal(taken.status, 409, await taken.text());
  assert.deepEqual(snapshot(), before, "the existing workspace is untouched");
  const fresh = await create("brand-new");
  assert.equal(fresh.status, 200, await fresh.text());
  assert.ok(fs.existsSync(path.join(DATA, TENANT, "workspaces", "brand-new", "AGENTS.md")));
  assert.equal((await create("brand-new")).status, 409, "twice is a refusal");
});

test("every reply is kept as a conversation its asker can list, search, read, continue and delete — no one else", async () => {
  const list = (await import("../app/api/assistant/conversations/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const one = (await import("../app/api/assistant/conversations/[id]/route.ts")) as {
    GET: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    DELETE: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  const { key: other } = await createApiKey(TENANT, "other", "owner@acme.test", undefined, "editor");
  const get = (url: string, key = editor) => new NextRequest(url, { headers: { authorization: `Bearer ${key}` } });
  assistant.setAssistantRunner(async () => ({ text: "Use when: rows of.", costUsd: 0, supply: "mock" }));

  const first = (await (await ask("how do I skip an empty csv step?")).json()) as { conversation: string; reply: string };
  assert.match(first.conversation, /^c_/);
  const again = (await (
    await post({
      messages: [
        { role: "user", content: "how do I skip an empty csv step?" },
        { role: "assistant", content: first.reply },
        { role: "user", content: "and for a json array?" },
      ],
      conversation: first.conversation,
    })
  ).json()) as { conversation: string };
  assert.equal(again.conversation, first.conversation, "carried on, not a new one");

  const mine = (await (await list.GET(get("http://localhost/api/assistant/conversations?q=CSV"))).json()) as { conversations: { id: string; title: string; messages: number; workspace: string }[] };
  const found = mine.conversations.find((c) => c.id === first.conversation)!;
  assert.ok(found, JSON.stringify(mine));
  assert.equal(found.title, "how do I skip an empty csv step?");
  assert.equal(found.messages, 4, "both questions and both answers");
  assert.equal(found.workspace, WS);
  const theirs = (await (await list.GET(get("http://localhost/api/assistant/conversations", other))).json()) as { conversations: unknown[] };
  assert.equal(theirs.conversations.length, 0, "another key sees none of mine");

  const ctxOf = { params: Promise.resolve({ id: first.conversation }) };
  assert.equal((await one.GET(get(`http://localhost/api/assistant/conversations/${first.conversation}`, other), ctxOf)).status, 404);
  const whole = (await (await one.GET(get(`http://localhost/api/assistant/conversations/${first.conversation}`), ctxOf)).json()) as { messages: { role: string }[]; owner?: string };
  assert.equal(whole.messages.length, 4);
  assert.equal(whole.owner, undefined, "the owner is not shown");
  const del = (key: string) => one.DELETE(new NextRequest(`http://localhost/api/assistant/conversations/${first.conversation}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }), ctxOf);
  assert.equal((await del(other)).status, 404);
  assert.equal((await del(editor)).status, 200);
  assert.equal((await one.GET(get(`http://localhost/api/assistant/conversations/${first.conversation}`), ctxOf)).status, 404);
  assert.equal((await post({ messages: [{ role: "user", content: "x" }], conversation: "../../etc" })).status, 400);
});

test.after(() => {
  assistant.setAssistantRunner(null);
  fs.rmSync(DATA, { recursive: true, force: true });
});
