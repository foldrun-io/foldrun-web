// A key scoped to some workspaces is refused the others' secrets, and the
// account's own, even though the vault names its workspace in the body or
// query rather than the path assertScope reads.
//
//   node --import ./tests/register.mjs --test tests/secrets-scope.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-secrets-scope-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
const { NextRequest } = await import("next/server");
const secrets = await import("../app/api/secrets/route.ts");
const start = await import("../app/api/oauth/start/route.ts");
const reconnect = await import("../app/api/oauth/reconnect/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { setSecret, listSecrets } = await import("../../foldrun-core/src/secrets.ts");

for (const ws of ["leads", "blog"]) {
  const dir = path.join(process.env.FOLDRUN_DATA, "acme/workspaces", ws);
  fs.mkdirSync(path.join(dir, "flows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
}
setSecret("acme", "ACCOUNT_TOKEN", "a", undefined);
setSecret("acme", "BLOG_TOKEN", "b", "blog");
setSecret("acme", "LEADS_TOKEN", "l", "leads");

const { key: scoped } = await createApiKey("acme", "scoped", "s@acme.test", undefined, "admin", ["leads"]);
const { key: full } = await createApiKey("acme", "full", "f@acme.test", undefined, "admin", null);

const call = (fn: (r: InstanceType<typeof NextRequest>) => Promise<Response>, key: string, method: string, url: string, body?: object) =>
  fn(new NextRequest(`http://x${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));

test("a scoped key cannot list, write or delete another workspace's secrets", async () => {
  assert.equal((await call(secrets.GET, scoped, "GET", "/api/secrets?workspace=blog")).status, 403);
  assert.equal((await call(secrets.PUT, scoped, "PUT", "/api/secrets", { name: "X", value: "v", workspace: "blog" })).status, 403);
  assert.equal((await call(secrets.DELETE, scoped, "DELETE", "/api/secrets", { name: "BLOG_TOKEN", workspace: "blog" })).status, 403);
  assert.ok(listSecrets("acme", "blog").some((s) => s.name === "BLOG_TOKEN" && s.scope === "workspace"));
  assert.ok(!listSecrets("acme", "blog").some((s) => s.name === "X"));
});

test("a scoped key cannot touch account-level secrets", async () => {
  assert.equal((await call(secrets.GET, scoped, "GET", "/api/secrets")).status, 403);
  assert.equal((await call(secrets.PUT, scoped, "PUT", "/api/secrets", { name: "ACCOUNT_TOKEN", value: "evil" })).status, 403);
  assert.equal((await call(secrets.DELETE, scoped, "DELETE", "/api/secrets", { name: "ACCOUNT_TOKEN" })).status, 403);
  assert.ok(listSecrets("acme").some((s) => s.name === "ACCOUNT_TOKEN"));
});

test("a scoped key works in its own workspace and sees only that workspace's names", async () => {
  const res = await call(secrets.GET, scoped, "GET", "/api/secrets?workspace=leads");
  assert.equal(res.status, 200);
  const names = ((await res.json()) as { secrets: { name: string }[] }).secrets.map((s) => s.name);
  assert.deepEqual(names, ["LEADS_TOKEN"]);
  assert.equal((await call(secrets.PUT, scoped, "PUT", "/api/secrets", { name: "NEW", value: "v", workspace: "leads" })).status, 200);
  assert.equal((await call(secrets.DELETE, scoped, "DELETE", "/api/secrets", { name: "NEW", workspace: "leads" })).status, 200);
});

test("an unscoped key still sees the account's secrets", async () => {
  const res = await call(secrets.GET, full, "GET", "/api/secrets?workspace=blog");
  const names = ((await res.json()) as { secrets: { name: string }[] }).secrets.map((s) => s.name);
  assert.deepEqual(names, ["ACCOUNT_TOKEN", "BLOG_TOKEN"]);
});

test("a scoped key cannot start or reconnect an OAuth grant outside its scope", async () => {
  assert.equal((await call(start.POST, scoped, "POST", "/api/oauth/start", { client: "c", secret: "S", workspace: "blog" })).status, 403);
  assert.equal((await call(start.POST, scoped, "POST", "/api/oauth/start", { client: "c", secret: "S" })).status, 403);
  assert.equal((await call(reconnect.POST, scoped, "POST", "/api/oauth/reconnect", { secret: "S", workspace: "blog" })).status, 403);
  assert.equal((await call(reconnect.POST, scoped, "POST", "/api/oauth/reconnect", { secret: "S" })).status, 403);
  // Its own workspace gets past the scope check to the lookup.
  assert.equal((await call(start.POST, scoped, "POST", "/api/oauth/start", { client: "c", secret: "S", workspace: "leads" })).status, 404);
});
