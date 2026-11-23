// Deleting an API key (17 Nov 2026: a tester found only Revoke, and the key
// listed forever). DELETE /v1/keys/<id>: a live key is revoked in the same
// moment and stops working; a revoked one just leaves the list; the audit log
// keeps the record; a key outside the caller's scope is not found.
//
//   node --import ./tests/register.mjs --test tests/api-key-delete.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-key-delete-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_RESEND_API_KEY;

const { NextRequest } = await import("next/server");
const { createApiKey, listApiKeys, revokeApiKey } = await import("../server/auth.ts");
process.env.FOLDRUN_OPEN_SIGNUP = "1";
const { createUser } = await import("../server/users.ts");
const keysRoute = await import("../app/v1/keys/route.ts");
const keyRoute = await import("../app/v1/keys/[id]/route.ts");
const auditRoute = await import("../app/v1/audit/route.ts");

await createUser("owner@acme.test", "correct horse battery staple 9", "acme", { request: "free" });
const { key: admin } = await createApiKey("acme", "ops", "owner@acme.test", undefined, "admin");

const call = (key: string, url: string, method = "GET") =>
  new NextRequest(`http://x${url}`, { method, headers: { authorization: `Bearer ${key}` } });
const del = (key: string, id: string) => keyRoute.DELETE(call(key, `/v1/keys/${id}`, "DELETE"), { params: Promise.resolve({ id }) });
const listed = async () => ((await (await keysRoute.GET(call(admin, "/v1/keys"))).json()) as { keys: { id: string }[] }).keys.map((k) => k.id);

test("a live key: deleted is revoked at once, gone from the list, and refused", async () => {
  const made = await createApiKey("acme", "ci", "owner@acme.test", undefined, "editor");
  assert.equal((await keysRoute.GET(call(made.key, "/v1/keys"))).status, 403, "it works (an editor's key, refused only for its role)");
  const res = await del(admin, made.record.id);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, id: made.record.id, revoked: true });
  assert.ok(!(await listed()).includes(made.record.id), "not listed");
  assert.equal((await keysRoute.GET(call(made.key, "/v1/keys"))).status, 401, "the key no longer opens anything");
  assert.equal((await del(admin, made.record.id)).status, 404, "a second delete finds nothing");
});

test("a revoked key: deleted just leaves the list", async () => {
  const made = await createApiKey("acme", "old", "owner@acme.test", undefined, "editor");
  await revokeApiKey("acme", made.record.id);
  assert.ok((await listed()).includes(made.record.id), "a revoked key is still listed");
  const res = await del(admin, made.record.id);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { revoked: boolean }).revoked, false);
  assert.ok(!(await listed()).includes(made.record.id));
});

test("only keys:manage, only within the caller's scope, another account's key is not found", async () => {
  const target = await createApiKey("acme", "keep", "owner@acme.test", undefined, "editor");
  const editor = await createApiKey("acme", "ed", "owner@acme.test", undefined, "editor");
  assert.equal((await del(editor.key, target.record.id)).status, 403);
  const scoped = await createApiKey("acme", "scoped-admin", "owner@acme.test", undefined, "admin", ["one"]);
  assert.equal((await del(scoped.key, target.record.id)).status, 404, "an account-wide key is outside a scoped admin's reach");
  const other = await createApiKey("globex", "theirs", undefined, undefined, "editor");
  assert.equal((await del(admin, other.record.id)).status, 404);
  assert.equal((await listApiKeys("globex")).length, 1, "untouched");
  assert.ok((await listed()).includes(target.record.id), "untouched");
});

test("the delete is in the audit log", async () => {
  const made = await createApiKey("acme", "audited", "owner@acme.test", undefined, "editor");
  await del(admin, made.record.id);
  const res = await auditRoute.GET(call(admin, "/v1/audit?action=apikey.deleted"));
  const body = (await res.json()) as { entries: { action: string; subject?: string; detail?: Record<string, unknown> }[] };
  const e = body.entries.find((x) => x.subject === made.record.id);
  assert.ok(e, JSON.stringify(body).slice(0, 300));
  assert.equal(e.action, "apikey.deleted");
  assert.equal(e.detail?.wasLive, true);
});
