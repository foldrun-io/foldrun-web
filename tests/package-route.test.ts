// Export a workspace, flow or agent as a .zip, and import one — the routes.
//
//   node --import ./tests/register.mjs --test tests/package-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-package-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const exp = (await import("../app/api/workspaces/[workspace]/export/route.ts")) as unknown as { GET: Handler };
const imp = (await import("../app/api/workspaces/[workspace]/import/route.ts")) as unknown as { POST: Handler };

const TENANT = "acme";
const write = (ws: string, rel: string, text: string) => {
  const p = path.join(DATA, TENANT, "workspaces", ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
write("blog", "AGENTS.md", "---\nname: blog\n---\n");
write("blog", "flows/publish.md", "---\ntrigger: manual\n---\n\n1. [[writer]] — Draft.\n");
write("blog", "agents/writer/agent.md", "---\nname: writer\ndescription: Writes.\nsecrets: [CMS_TOKEN]\n---\n\nWrite.\n");
write("blog", "agents/writer/memory/lesson.md", "---\ntype: Fact\n---\n\nblog only\n");
write("blog", "agents/loner/agent.md", "---\nname: loner\ndescription: Alone.\n---\n\nx\n");
write("fresh", "AGENTS.md", "---\nname: fresh\n---\n");
write("secret-desk", "AGENTS.md", "---\nname: secret-desk\n---\n");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const get = (url: string, key: string) => new NextRequest(`http://localhost${url}`, { headers: { authorization: `Bearer ${key}` } });
const post = (url: string, key: string, body: Uint8Array<ArrayBuffer>) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/zip", "content-length": String(body.length) }, body });
const ctx = (workspace: string) => ({ params: Promise.resolve({ workspace }) });

async function exportOf(url: string, ws: string, key = admin) {
  const r = await exp.GET(get(url, key), ctx(ws));
  assert.equal(r.status, 200, await r.clone().text());
  return { r, bytes: new Uint8Array(await r.arrayBuffer()) as Uint8Array<ArrayBuffer> };
}

test("export a flow: a zip named for it, with its agent and no memory", async () => {
  const { r, bytes } = await exportOf("/api/workspaces/blog/export?kind=flow&name=publish", "blog");
  assert.equal(r.headers.get("content-type"), "application/zip");
  assert.match(r.headers.get("content-disposition") ?? "", /blog-flow-publish\.zip/);
  const { unzip } = await import("@/lib/zip");
  const names = unzip(Buffer.from(bytes)).map((e) => e.path).sort();
  assert.deepEqual(names, ["agents/writer/agent.md", "flows/publish.md", "foldrun-package.json"]);
  const missing = await exp.GET(get("/api/workspaces/blog/export?kind=flow&name=nosuch", admin), ctx("blog"));
  assert.equal(missing.status, 404);
  const bad = await exp.GET(get("/api/workspaces/blog/export?kind=secrets", admin), ctx("blog"));
  assert.equal(bad.status, 400);
});

test("a viewer may export; may not import", async () => {
  const { bytes } = await exportOf("/api/workspaces/blog/export?kind=agent&name=writer", "blog", viewer);
  const r = await imp.POST(post("/api/workspaces/fresh/import", viewer, bytes), ctx("fresh"));
  assert.equal(r.status, 403);
});

test("dry run previews and writes nothing; apply writes; overwrite is asked for", async () => {
  const { bytes } = await exportOf("/api/workspaces/blog/export?kind=flow&name=publish", "blog");
  const dry = await imp.POST(post("/api/workspaces/fresh/import?dryRun=1", admin, bytes), ctx("fresh"));
  assert.equal(dry.status, 200, await dry.clone().text());
  const plan = await dry.json();
  assert.deepEqual(plan.added, ["agents/writer/agent.md", "flows/publish.md"]);
  assert.deepEqual(plan.needs.secrets, ["CMS_TOKEN"]);
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "fresh", "flows/publish.md")), false);

  const ok = await imp.POST(post("/api/workspaces/fresh/import", admin, bytes), ctx("fresh"));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).written.length, 2);

  write("fresh", "agents/writer/agent.md", "---\nname: writer\ndescription: Changed here.\n---\n\nMine.\n");
  const clash = await imp.POST(post("/api/workspaces/fresh/import", admin, bytes), ctx("fresh"));
  assert.equal(clash.status, 409);
  assert.match(fs.readFileSync(path.join(DATA, TENANT, "workspaces", "fresh", "agents/writer/agent.md"), "utf8"), /Mine/);
  const over = await imp.POST(post("/api/workspaces/fresh/import?overwrite=1", admin, bytes), ctx("fresh"));
  assert.equal(over.status, 200);
  assert.doesNotMatch(fs.readFileSync(path.join(DATA, TENANT, "workspaces", "fresh", "agents/writer/agent.md"), "utf8"), /Mine/);
});

test("a workspace package makes a new workspace; garbage is a 400", async () => {
  const { bytes } = await exportOf("/api/workspaces/blog/export", "blog");
  const r = await imp.POST(post("/api/workspaces/blog-copy/import", admin, bytes), ctx("blog-copy"));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).creates, true);
  assert.ok(fs.existsSync(path.join(DATA, TENANT, "workspaces", "blog-copy", "agents/loner/agent.md")));
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "workspaces", "blog-copy", "agents/writer/memory")), false);

  const bad = await imp.POST(post("/api/workspaces/fresh/import", admin, new TextEncoder().encode("not a zip")), ctx("fresh"));
  assert.equal(bad.status, 400);
});

test("a key scoped to some workspaces cannot export another", async () => {
  const { key } = await createApiKey(TENANT, "scoped", "owner@acme.test", undefined, "editor", ["fresh"]);
  const r = await exp.GET(get("/api/workspaces/secret-desk/export", key), ctx("secret-desk"));
  assert.equal(r.status, 403);
});

test("no Content-Length is a 411, too large a one a 413 — before the body is read", async () => {
  const body = new TextEncoder().encode("PK");
  const none = new NextRequest("http://localhost/api/workspaces/fresh/import", { method: "POST", headers: { authorization: `Bearer ${admin}` }, body });
  assert.equal((await imp.POST(none, ctx("fresh"))).status, 411);
  const big = new NextRequest("http://localhost/api/workspaces/fresh/import", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-length": String(30 * 1024 * 1024) }, body });
  assert.equal((await imp.POST(big, ctx("fresh"))).status, 413);
});

test("the dialog's suggested workspace name is always a valid one", async () => {
  const { suggestName } = await import("../components/package-name.ts");
  assert.equal(suggestName("blog (1).zip"), "blog-1");
  assert.equal(suggestName("Blog_v2.zip"), "blog-v2");
  assert.equal(suggestName("blog.zip"), "blog");
  assert.equal(suggestName("--x--.ZIP"), "x");
});
