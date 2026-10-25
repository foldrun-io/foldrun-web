// "Create workspace" is blank, and an agent from another workspace can be
// imported into it — with the source workspace scope-checked.
//
//   node --import ./tests/register.mjs --test tests/agent-import-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-import-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const create = (await import("../app/api/workspaces/route.ts")) as unknown as { POST: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
const imp = (await import("../app/api/workspaces/[workspace]/agents/import/route.ts")) as unknown as { GET: Handler; POST: Handler };

const TENANT = "acme";
const src = path.join(DATA, TENANT, "workspaces", "blog");
fs.mkdirSync(path.join(src, "agents/reviewer/memory"), { recursive: true });
fs.writeFileSync(path.join(src, "AGENTS.md"), "---\nname: blog\n---\n");
fs.writeFileSync(path.join(src, "agents/reviewer/agent.md"), "---\nname: reviewer\ndescription: Reviews drafts.\nsecrets: [GITHUB_TOKEN]\n---\n\nReview.\n");
fs.writeFileSync(path.join(src, "agents/reviewer/memory/lesson.md"), "---\ntype: Fact\n---\n\nblog only\n");
fs.mkdirSync(path.join(DATA, TENANT, "workspaces", "secret-desk", "agents/spy"), { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "workspaces", "secret-desk", "AGENTS.md"), "---\nname: secret-desk\n---\n");
fs.writeFileSync(path.join(DATA, TENANT, "workspaces", "secret-desk", "agents/spy/agent.md"), "---\nname: spy\n---\n\nx\n");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const req = (url: string, key: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const ctx = (workspace: string) => ({ params: Promise.resolve({ workspace }) });

test("the dashboard's create makes a blank workspace", async () => {
  const r = await create.POST(req("/api/workspaces", admin, "POST", { name: "fresh", template: true }));
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.agents, 0);
  assert.equal(body.flows, 0);
  const files = fs.readdirSync(path.join(DATA, TENANT, "workspaces", "fresh"));
  assert.deepEqual(files.filter((f) => !f.startsWith(".")), ["AGENTS.md"]);
});

test("GET lists the other workspaces' agents; POST copies one without its memory", async () => {
  const list = await (await imp.GET(req("/api/workspaces/fresh/agents/import", admin), ctx("fresh"))).json();
  assert.deepEqual(list.workspaces.map((w: { name: string }) => w.name).sort(), ["blog", "secret-desk"]);

  const r = await imp.POST(req("/api/workspaces/fresh/agents/import", admin, "POST", { from: "blog", agent: "reviewer" }), ctx("fresh"));
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.deepEqual(body.files, ["agents/reviewer/agent.md"]);
  assert.ok(body.warnings.some((w: string) => /GITHUB_TOKEN/.test(w)));
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "fresh", "agents/reviewer/memory")), false);

  const again = await imp.POST(req("/api/workspaces/fresh/agents/import", admin, "POST", { from: "blog", agent: "reviewer" }), ctx("fresh"));
  assert.equal(again.status, 409);
});

test("a key scoped to some workspaces cannot copy out of another", async () => {
  const { key } = await createApiKey(TENANT, "scoped", "owner@acme.test", undefined, "editor", ["fresh", "blog"]);
  const list = await (await imp.GET(req("/api/workspaces/fresh/agents/import", key), ctx("fresh"))).json();
  assert.deepEqual(list.workspaces.map((w: { name: string }) => w.name), ["blog"]);
  const r = await imp.POST(req("/api/workspaces/fresh/agents/import", key, "POST", { from: "secret-desk", agent: "spy" }), ctx("fresh"));
  assert.equal(r.status, 403);
});
