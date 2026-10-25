// Hooks on the web tier: the Test route (runs one hook on a sample event, or
// refuses on an install that isolates runs — a hook is customer code and only
// runs in a step's sandbox there), the listing with what hooks did lately,
// and the pure model the Hooks panel and the run page's badge share.
//
//   node --import ./tests/register.mjs --test tests/hooks-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hooks-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_RUN_ISOLATION;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const testRoute = (await import("../app/api/workspaces/[workspace]/hooks/[flow]/test/route.ts")) as unknown as { POST: Handler };
const listRoute = (await import("../app/api/workspaces/[workspace]/hooks/route.ts")) as unknown as { GET: Handler };
const { hookTestRefusal, testEvent, HOOK_SAMPLE } = await import("../server/hooks.ts");
const { hookActivity, hookTally, hookBadge } = await import("../components/hooks-model.ts");
const { classify } = await import("../components/trace-model.ts");
const { startingFiles } = await import("../server/starters.ts");

const TENANT = "acme";
const ws = path.join(DATA, TENANT, "workspaces", "desk");
const lib = path.join(DATA, TENANT, "library");
const hook = (root: string, name: string, md: string, code: string) => {
  fs.mkdirSync(path.join(root, "hooks", name), { recursive: true });
  fs.writeFileSync(path.join(root, "hooks", name, "hook.md"), md);
  fs.writeFileSync(path.join(root, "hooks", name, "run.mjs"), code);
};
const READ = `let raw = ""; for await (const c of process.stdin) raw += c; const e = JSON.parse(raw);`;

fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\nhooks: [no-rm]\n---\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: Writes.\nhooks: [shout]\n---\n\nWrite.\n");
hook(ws, "no-rm", "---\non: tool.call\ntool: Bash\ndescription: No rm -rf.\n---\n",
  `${READ}\nif (/rm -rf/.test(e.tool.input.command)) { process.stderr.write("rm -rf is not allowed"); process.exit(2); }\nconsole.log(JSON.stringify({ input: { command: e.tool.input.command + " --dry-run" } }));`);
hook(ws, "leaky", "---\non: tool.result\n---\n", `console.log(JSON.stringify({ note: Object.keys(process.env).sort().join(",") }));`);
hook(ws, "broken", "---\non: run.end\n---\n", "");
hook(lib, "shout", "---\non: step.end\n---\n", `${READ}\nconsole.log(JSON.stringify({ reply: String(e.reply).toUpperCase() }));`);
hook(lib, "no-rm", "---\non: tool.call\n---\n", `console.log("{}")`);

// One run whose trail carries hook records, as step-exec writes them.
fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
fs.writeFileSync(path.join(ws, "runs", "r1.json"), JSON.stringify({
  id: "r1", flow: "publish", status: "completed", startedAt: "2026-10-11T01:00:00.000Z",
  steps: [{
    agent: "writer", status: "completed", instruction: "Write.",
    events: [
      { t: "2026-10-11T01:00:01.000Z", type: "error", text: "hook no-rm denied Bash: rm -rf is not allowed", hook: { hook: "no-rm", event: "tool.call", did: "deny", tool: "Bash", reason: "rm -rf is not allowed", ms: 12 } },
      { t: "2026-10-11T01:00:02.000Z", type: "info", text: "hook no-rm rewrote Bash", hook: { hook: "no-rm", event: "tool.call", did: "rewrite", tool: "Bash", ms: 9 } },
      { t: "2026-10-11T01:00:03.000Z", type: "info", text: "hook shout added context to the step", hook: { hook: "shout", event: "step.start", did: "context", ms: 3 } },
      { t: "2026-10-11T01:00:04.000Z", type: "text", text: "Done." },
    ],
  }],
}));

const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const post = (name: string, body: unknown, key: string | undefined = editor) =>
  testRoute.POST(
    new NextRequest(`http://localhost/api/workspaces/desk/hooks/${name}/test`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    }),
    ctx({ workspace: "desk", flow: name }),
  );

test("a deny: exit 2 with stderr as the reason", async () => {
  const res = await post("no-rm", { event: { tool: { name: "Bash", input: { command: "rm -rf /" } } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.on, "tool.call");
  assert.equal(body.scope, "workspace", "the workspace's hook shadows the library's of the same name");
  assert.equal(body.decision, "deny");
  assert.match(body.reason, /rm -rf is not allowed/);
  assert.equal(body.event.hook, "no-rm");
  assert.equal(body.event.workspace, "desk");
});

test("a rewrite comes back as the new input", async () => {
  const body = await (await post("no-rm", { event: { tool: { name: "Bash", input: { command: "ls" } } } })).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.input, { command: "ls --dry-run" });
});

test("no event: the sample for its on:, from the library when the workspace has none", async () => {
  const body = await (await post("shout", {})).json();
  assert.equal(body.scope, "account");
  assert.equal(body.reply, "DONE.");
  assert.deepEqual(testEvent({ name: "shout", on: "step.end" }, "desk", undefined).reply, HOOK_SAMPLE["step.end"].reply);
});

test("the hook's process sees no platform secret", async () => {
  process.env.FOLDRUN_SECRET_KEY = "do-not-leak";
  try {
    const body = await (await post("leaky", {})).json();
    assert.ok(!/FOLDRUN_SECRET_KEY/.test(body.note), body.note);
  } finally {
    delete process.env.FOLDRUN_SECRET_KEY;
  }
});

test("missing is 404, invalid is 422, a non-object event is 400", async () => {
  assert.equal((await post("nope", {})).status, 404);
  const bad = await post("broken", {});
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /on: must be one of/);
  assert.equal((await post("no-rm", { event: [1] })).status, 400);
});

test("run:start: a viewer and no key are refused", async () => {
  assert.equal((await post("no-rm", {}, "")).status, 401);
  assert.equal((await post("no-rm", {}, viewer)).status, 403);
});

test("an isolated install refuses rather than spawn customer code in the web process", async () => {
  const marker = path.join(DATA, "spawned");
  hook(ws, "toucher", "---\non: step.start\n---\n", `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "x"); console.log("{}");`);
  for (const mode of ["k8s", "container"]) {
    process.env.FOLDRUN_RUN_ISOLATION = mode;
    try {
      const res = await post("toucher", {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.testable, false);
      assert.match(body.summary, /inside a run's sandbox/);
      assert.match(body.detail, /foldrun hook test/);
      assert.equal(body.failure, body.summary, "the CLI prints `failure`");
      assert.ok(!fs.existsSync(marker), `the hook ran under FOLDRUN_RUN_ISOLATION=${mode}`);
    } finally {
      delete process.env.FOLDRUN_RUN_ISOLATION;
    }
  }
  assert.equal(hookTestRefusal({}), null);
  assert.ok(hookTestRefusal({ FOLDRUN_RUN_ISOLATION: "k8s" }));
});

test("the listing: both scopes, shadowing, who turns each on, and recent denies and rewrites", async () => {
  const res = await listRoute.GET(
    new NextRequest("http://localhost/api/workspaces/desk/hooks", { headers: { authorization: `Bearer ${viewer}` } }),
    ctx({ workspace: "desk" }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  const by = (name: string, scope: string) => body.hooks.find((h: { name: string; scope: string }) => h.name === name && h.scope === scope);
  assert.equal(by("no-rm", "workspace").tool, "Bash");
  assert.deepEqual(by("no-rm", "workspace").onFor, ["workspace"]);
  assert.equal(by("no-rm", "account").shadowed, true);
  assert.deepEqual(by("shout", "account").onFor, ["writer"]);
  assert.match(by("broken", "workspace").error, /on:/);
  assert.deepEqual(body.recent.map((r: { record: { did: string } }) => r.record.did), ["rewrite", "deny"], "loud only, newest first");
  assert.equal(body.recent[0].runId, "r1");
  assert.equal(body.recent[0].step, 1);
});

test("model: tally, badges, and the trace keeps the hook on its line", () => {
  const run = JSON.parse(fs.readFileSync(path.join(ws, "runs", "r1.json"), "utf8"));
  const all = hookActivity([run]);
  assert.equal(all.length, 3);
  const t = hookTally(all).get("no-rm")!;
  assert.deepEqual([t.deny, t.rewrite, t.error, t.last], [1, 1, 0, "2026-10-11T01:00:02.000Z"]);
  assert.equal(hookActivity([run], { limit: 1 }).length, 1);
  assert.deepEqual(hookBadge({ hook: "no-rm", did: "deny" }), { label: "no-rm denied", tone: "error" });
  assert.equal(hookBadge({ hook: "x", did: "rewrite" }).tone, "warn");

  const deny = classify(run.steps[0].events[0]);
  assert.equal(deny.kind, "error");
  assert.equal(deny.hook?.did, "deny");
  // A rewrite is an info line; it must not sink into the System filter.
  const rewrite = classify(run.steps[0].events[1]);
  assert.equal(rewrite.kind, "tool");
  assert.equal(rewrite.hook?.hook, "no-rm");
  assert.equal(classify({ type: "info", text: "egress: x" }).hook, undefined);
});

test("New hook writes hook.md and a run.mjs — hook.md alone is not a hook", () => {
  const files = startingFiles("hooks", "guard");
  assert.deepEqual(files.map((f) => f.file), ["hooks/guard/hook.md", "hooks/guard/run.mjs"]);
  assert.match(files[1].content, /decision: "allow"/);
});
