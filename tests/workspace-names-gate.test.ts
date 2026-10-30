// Names that are one folder, never a path, and workspaces that are only made
// through the doors that may make them (API review, 30 Oct 2026):
//
//   - POST …/agents/<agent>/run and …/hooks/<name>/test refuse a name that
//     is a path (Next decodes %2F in a segment);
//   - a write into a workspace that does not exist is a 404 and makes nothing;
//   - a deploy to a new name needs workspace:manage, as POST /api/workspaces;
//   - POST /api/workspaces over an existing name takes the deploy's gate;
//   - PATCH { description } cannot add frontmatter keys.
//
//   node --import ./tests/register.mjs --test tests/workspace-names-gate.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-names-gate-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Req = InstanceType<typeof NextRequest>;
type Ctx<P> = { params: Promise<P> };
const agentRun = (await import("../app/api/workspaces/[workspace]/agents/[agent]/run/route.ts")) as unknown as { POST: (r: Req, c: Ctx<{ workspace: string; agent: string }>) => Promise<Response> };
const hookTest = (await import("../app/api/workspaces/[workspace]/hooks/[flow]/test/route.ts")) as unknown as { POST: (r: Req, c: Ctx<{ workspace: string; flow: string }>) => Promise<Response> };
const deploy = (await import("../app/api/workspaces/[workspace]/deploy/route.ts")) as unknown as { POST: (r: Req, c: Ctx<{ workspace: string }>) => Promise<Response> };
const flows = (await import("../app/api/workspaces/[workspace]/flows/route.ts")) as unknown as { POST: (r: Req, c: Ctx<{ workspace: string }>) => Promise<Response> };
const workspaces = (await import("../app/api/workspaces/route.ts")) as unknown as { POST: (r: Req) => Promise<Response> };
const workspace = (await import("../app/api/workspaces/[workspace]/route.ts")) as unknown as { PATCH: (r: Req, c: Ctx<{ workspace: string }>) => Promise<Response> };

const TENANT = "acme";
const ws = path.join(DATA, TENANT, "workspaces", "desk");
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.mkdirSync(path.join(ws, "hooks"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\ndescription: a desk\n---\n\nThe desk.\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
// Another account's agent and hook, reachable by `..` from this workspace.
const other = path.join(DATA, "bigcorp", "workspaces", "w");
fs.mkdirSync(path.join(other, "agents/spy"), { recursive: true });
fs.writeFileSync(path.join(other, "agents/spy/agent.md"), "---\nname: spy\n---\n\nSpy.\n");
fs.mkdirSync(path.join(other, "hooks/guard"), { recursive: true });
fs.writeFileSync(path.join(other, "hooks/guard/hook.md"), "---\non: tool.call\n---\n");
fs.writeFileSync(path.join(other, "hooks/guard/run.mjs"), "console.log('{}')\n");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const { key: editor } = await createApiKey(TENANT, "editor", "ed@acme.test", undefined, "editor");
const req = (url: string, key: string, method = "POST", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const p = <T>(v: T) => ({ params: Promise.resolve(v) });

test("an agent name that is a path is a 400 — the other account's agent is never run", async () => {
  const agent = "../../../../bigcorp/workspaces/w/agents/spy";
  assert.ok(fs.existsSync(path.join(ws, "agents", agent, "agent.md")), "the traversal lands on a real agent");
  const r = await agentRun.POST(req(`/api/workspaces/desk/agents/x/run`, editor, "POST", { task: "go" }), p({ workspace: "desk", agent }));
  assert.equal(r.status, 400, await r.clone().text());
  assert.match(((await r.json()) as { error: string }).error, /invalid agent/);
  assert.ok(!fs.existsSync(path.join(ws, "runs")) || fs.readdirSync(path.join(ws, "runs")).length === 0, "no run was made");
});

test("a hook name that is a path is a 400, the same answer whether or not it exists", async () => {
  for (const name of ["../../../../bigcorp/workspaces/w/hooks/guard", "../../../../nobody/here"]) {
    const r = await hookTest.POST(req(`/api/workspaces/desk/hooks/x/test`, editor, "POST", {}), p({ workspace: "desk", flow: name }));
    assert.equal(r.status, 400, `${name}: ${await r.clone().text()}`);
    assert.match(((await r.json()) as { error: string }).error, /invalid hook/);
  }
});

test("a write into a workspace that does not exist is a 404, and makes nothing", async () => {
  const r = await flows.POST(req("/api/workspaces/ghost/flows", editor, "POST", { name: "x" }), p({ workspace: "ghost" }));
  assert.equal(r.status, 404, await r.clone().text());
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "ghost")), false);
});

test("a deploy that would make a workspace needs an admin; one to a workspace that exists, an editor", async () => {
  const files = [
    { path: "AGENTS.md", content: "---\nname: new-desk\n---\n\nNew.\n" },
    { path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes\n---\n\nWrite.\n" },
  ];
  const refused = await deploy.POST(req("/api/workspaces/new-desk/deploy", editor, "POST", { files }), p({ workspace: "new-desk" }));
  assert.equal(refused.status, 403, await refused.clone().text());
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "new-desk")), false, "nothing was made");

  const dry = await deploy.POST(req("/api/workspaces/new-desk/deploy", editor, "POST", { files, dryRun: true }), p({ workspace: "new-desk" }));
  assert.equal(dry.status, 200, "a dry run writes nothing and is not asked");

  const made = await deploy.POST(req("/api/workspaces/new-desk/deploy", admin, "POST", { files }), p({ workspace: "new-desk" }));
  assert.equal(made.status, 200, await made.clone().text());
  assert.ok(fs.existsSync(path.join(DATA, TENANT, "workspaces", "new-desk", "AGENTS.md")), "`foldrun deploy` of a new workspace still works for an admin");

  const again = await deploy.POST(
    req("/api/workspaces/new-desk/deploy", editor, "POST", { files: [{ ...files[0], content: "---\nname: new-desk\n---\n\nEdited.\n" }, files[1]] }),
    p({ workspace: "new-desk" }),
  );
  assert.equal(again.status, 200, await again.clone().text());
});

test("a deploy's bad commit is a 400 and the live files are untouched", async () => {
  const before = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
  const r = await deploy.POST(
    req("/api/workspaces/desk/deploy", admin, "POST", { files: [{ path: "AGENTS.md", content: "---\nname: desk\n---\n\nSwapped.\n" }], commit: "../not a commit" }),
    p({ workspace: "desk" }),
  );
  assert.equal(r.status, 400, await r.clone().text());
  assert.equal(fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8"), before);
});

test("POST /api/workspaces over a name that exists takes the deploy's checks", async () => {
  const before = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
  const r = await workspaces.POST(
    req("/api/workspaces", admin, "POST", {
      name: "desk",
      files: [
        { path: "AGENTS.md", content: "---\nname: desk\n---\n" },
        { path: "flows/broken.md", content: "---\nname: broken\ntrigger: manual\n---\n\n1. [[ghost]] — nobody is called this\n" },
      ],
    }),
  );
  assert.equal(r.status, 422, await r.clone().text());
  const body = (await r.json()) as { ok: boolean; issues: unknown[] };
  assert.equal(body.ok, false);
  assert.ok(body.issues.length > 0);
  assert.equal(fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8"), before, "nothing was replaced");
  assert.ok(fs.existsSync(path.join(ws, "agents/writer/agent.md")));
});

test("PATCH { description } is one value: a newline cannot add a key", async () => {
  const r = await workspace.PATCH(
    req("/api/workspaces/desk", admin, "PATCH", { description: "fine\nnetwork_enforce: false\nnotify: {url: https://evil.example/x}" }),
    p({ workspace: "desk" }),
  );
  assert.equal(r.status, 200, await r.clone().text());
  const raw = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
  assert.doesNotMatch(raw, /^network_enforce:/m);
  assert.doesNotMatch(raw, /^notify:/m);
  assert.match(raw, /The desk\./);
});
