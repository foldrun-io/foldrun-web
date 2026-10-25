// GET /api/workspaces/<ws>/hooks/<flow>: a webhook's URL can be read without
// rotating it. Before 11 Oct 2026 rotate was the only route that returned it,
// so a script that wanted the URL broke the one already in use.
//
//   node --import ./tests/register.mjs --test tests/webhook-read.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-webhook-read-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_PUBLIC_URL = "https://foldrun.example/";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { webhookPath, hookGeneration } = await import("@/lib/webhook");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const read = (await import("../app/api/workspaces/[workspace]/hooks/[flow]/route.ts")) as unknown as { GET: Handler };

const TENANT = "acme";
const dir = path.join(DATA, TENANT, "workspaces", "desk");
fs.mkdirSync(path.join(dir, "flows"), { recursive: true });
fs.mkdirSync(path.join(dir, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(dir, "agents/writer/agent.md"), "---\nname: writer\ndescription: Writes.\n---\n\nWrite.\n");
fs.writeFileSync(path.join(dir, "flows/publish.md"), "---\ntrigger: webhook\n---\n\n1. [[writer]] — Write it.\n");
fs.writeFileSync(path.join(dir, "flows/daily.md"), "---\ntrigger: manual\n---\n\n1. [[writer]] — Write it.\n");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor", ["desk"]);

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const get = (flow: string, key?: string) =>
  read.GET(
    new NextRequest(`http://localhost/api/workspaces/desk/hooks/${flow}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }),
    ctx({ workspace: "desk", flow }),
  );

test("reads the webhook URL, absolute when FOLDRUN_PUBLIC_URL is set, and does not rotate it", async () => {
  const before = hookGeneration(TENANT, "desk", "publish");
  const res = await get("publish", admin);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.path, webhookPath(TENANT, "desk", "publish"));
  assert.match(body.path, /^\/api\/hooks\/acme\/desk\/publish\?token=[0-9a-f]{32}$/);
  assert.equal(body.url, `https://foldrun.example${body.path}`);
  assert.equal(hookGeneration(TENANT, "desk", "publish"), before, "reading must not rotate");
  const again = await (await get("publish", admin)).json();
  assert.equal(again.path, body.path, "the same URL every read");
});

test("a flow that is not trigger: webhook has no URL to read", async () => {
  const res = await get("daily", admin);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /not webhook/);
});

test("an unknown flow is a 404", async () => {
  assert.equal((await get("nope", admin)).status, 404);
});

test("the URL is a credential: workspace:manage, as rotate and the settings page", async () => {
  assert.equal((await get("publish")).status, 401);
  assert.equal((await get("publish", editor)).status, 403);
});
