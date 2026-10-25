// A key carries a role and a scope, both copied from its minter and never
// wider; a key from before either existed is what it always was — an admin
// of everything; and a deploy key, from when the platform had its own git,
// opens nothing.
//
//   node --import ./tests/register.mjs --test tests/api-keys.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { withinMinter, keyWithin } from "../server/key-scope.ts";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-keys-"));
const { createApiKey, apiKeyFor, listApiKeys, resolveTenant } = await import("../server/auth.ts");
const { NextRequest } = await import("next/server");

test("a key remembers its role and workspaces, and apiKeyFor reads them back", async () => {
  const { key, record } = await createApiKey("acme", "ci", "me@acme.test", undefined, "editor", ["leads", "blog"]);
  assert.equal(record.role, "editor");
  assert.deepEqual(record.workspaces, ["leads", "blog"]);
  assert.deepEqual(await apiKeyFor(key), { tenant: "acme", label: "ci", prefix: record.prefix, role: "editor", workspaces: ["leads", "blog"] });
  assert.ok(!Object.values((await apiKeyFor(key))!).includes(key), "never the secret");
  const all = await createApiKey("acme", "laptop", "me@acme.test", undefined, "viewer");
  assert.equal((await apiKeyFor(all.key))?.workspaces, null, "unscoped by default");
  assert.ok((await listApiKeys("acme")).every((k) => !("hash" in k)));
});

test("a key minted before roles and scopes existed is an admin of every workspace", async () => {
  // Written the way keys.json held them: no role, no workspaces — only the
  // hash of the key, which is what apiKeyFor looks up. With a database the
  // file is read once, by the boot import, so the case goes through it.
  const file = path.join(process.env.FOLDRUN_DATA!, "keys.json");
  const keys = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>[]) : [];
  const presented = "mda_legacy";
  const legacy: Record<string, unknown> = {
    id: "legacy",
    hash: crypto.createHash("sha256").update(presented).digest("hex"),
    prefix: "mda_legacy00",
    label: "old",
    tenant: "acme",
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  fs.writeFileSync(file, JSON.stringify([...keys, legacy]));
  if (process.env.FOLDRUN_DATABASE_URL) {
    const { importApiKeys } = await import("../server/auth.ts");
    assert.ok((await importApiKeys()) >= 1, "the boot import brings it in");
    assert.equal(fs.existsSync(file), false, "and moves the file aside");
  }
  assert.deepEqual(await apiKeyFor(presented), { tenant: "acme", label: "old", prefix: "mda_legacy00", role: "admin", workspaces: null });
});

test("withinMinter: a key is never above its minter's role", () => {
  assert.throws(() => withinMinter({ role: "editor", workspaces: null }, { role: "admin" }), /cannot outrank/);
  assert.deepEqual(withinMinter({ role: "editor", workspaces: null }, { role: "editor" }), { role: "editor", workspaces: null });
  assert.deepEqual(withinMinter({ role: "admin", workspaces: null }, { role: "viewer", workspaces: ["leads"] }), { role: "viewer", workspaces: ["leads"] });
});

test("withinMinter: a scoped minter's key is scoped — theirs unsaid, narrower if asked, never wider", () => {
  const minter = { role: "admin" as const, workspaces: ["leads", "blog"] };
  assert.deepEqual(withinMinter(minter, { role: "admin" }), { role: "admin", workspaces: ["leads", "blog"] });
  assert.deepEqual(withinMinter(minter, { role: "admin", workspaces: ["blog"] }), { role: "admin", workspaces: ["blog"] });
  assert.throws(() => withinMinter(minter, { role: "admin", workspaces: null }), /cannot open them all/);
  assert.throws(() => withinMinter(minter, { role: "admin", workspaces: ["blog", "seo"] }), /seo/);
  const err = (() => { try { withinMinter(minter, { role: "admin", workspaces: null }); } catch (e) { return e as { status?: number }; } })();
  assert.equal(err?.status, 403);
});


test("keyWithin: a scoped admin reaches only keys it could have minted", () => {
  const minter = { role: "admin" as const, workspaces: ["leads", "blog"] };
  assert.equal(keyWithin(minter, { role: "editor", workspaces: ["leads"] }), true);
  assert.equal(keyWithin(minter, { role: "admin", workspaces: null }), false, "an unscoped key is the account's");
  assert.equal(keyWithin(minter, { role: "viewer", workspaces: ["leads", "seo"] }), false);
  assert.equal(keyWithin(minter, {}), false, "a legacy key opens everything");
  assert.equal(keyWithin({ role: "editor", workspaces: null }, { role: "admin", workspaces: null }), false);
  assert.equal(keyWithin({ role: "admin", workspaces: null }, {}), true);
});

test("GET and DELETE /api/keys: a scoped admin cannot list or revoke a key outside its scope", async () => {
  delete process.env.FOLDRUN_DEV_NO_AUTH;
  const { NextRequest } = await import("next/server");
  const route = await import("../app/api/keys/route.ts");
  const { key: scoped, record: mine } = await createApiKey("scoped-co", "scoped", "s@x.test", undefined, "admin", ["leads"]);
  const { record: owners } = await createApiKey("scoped-co", "owner's", "o@x.test", undefined, "admin", null);
  const req = (method: string, body?: object) =>
    new NextRequest("http://x/api/keys", {
      method,
      headers: { authorization: `Bearer ${scoped}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const listed = ((await (await route.GET(req("GET"))).json()) as { keys: { id: string }[] }).keys.map((k) => k.id);
  assert.deepEqual(listed, [mine.id]);
  assert.equal((await route.DELETE(req("DELETE", { id: owners.id }))).status, 404);
  assert.equal((await listApiKeys("scoped-co")).find((k) => k.id === owners.id)?.revokedAt, null, "the owner's key still works");
  assert.equal((await route.DELETE(req("DELETE", { id: mine.id }))).status, 200);
});

test("FOL-66: a non-admin key revokes ITSELF (so `foldrun logout` ends it) and is rejected after; it still cannot revoke another key", async () => {
  delete process.env.FOLDRUN_DEV_NO_AUTH;
  const route = await import("../app/api/keys/route.ts");
  // Minted at the person's own role, as `foldrun login`'s device flow does.
  const { key: editorKey, record: mine } = await createApiKey("logout-co", "cli · laptop", "e@x.test", undefined, "editor");
  const { record: other } = await createApiKey("logout-co", "someone else", "o@x.test", undefined, "admin", null);
  const del = (id: string) =>
    route.DELETE(
      new NextRequest("http://x/api/keys", {
        method: "DELETE",
        headers: { authorization: `Bearer ${editorKey}`, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    );

  // Self-revoke must not widen keys:manage: an editor key still cannot end
  // someone else's key.
  assert.equal((await del(other.id)).status, 403);
  assert.equal((await listApiKeys("logout-co")).find((k) => k.id === other.id)?.revokedAt, null, "the other key still works");

  // But it can always end its own, with no admin role.
  assert.equal((await del(mine.id)).status, 200);
  assert.ok((await listApiKeys("logout-co")).find((k) => k.id === mine.id)?.revokedAt, "its own key is revoked");

  // And the exact credential the CLI dropped no longer calls the API.
  assert.equal(await apiKeyFor(editorKey), null, "the key no longer authenticates");
  const after = await resolveTenant(new NextRequest("http://x/api/me", { headers: { authorization: `Bearer ${editorKey}` } }));
  assert.equal(after.tenant, null, "every route now refuses it");
});

test("a deploy key minted before the platform's git went opens nothing, through either door; none can be minted", async () => {
  const file = path.join(process.env.FOLDRUN_DATA!, "keys.json");
  const keys = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>[]) : [];
  const presented = "mdk_" + "0".repeat(48);
  keys.push({
    id: "deploykey01",
    hash: crypto.createHash("sha256").update(presented).digest("hex"),
    prefix: presented.slice(0, 12),
    label: "ci-push",
    tenant: "acme",
    createdAt: "2026-10-01T00:00:00.000Z",
    revokedAt: null,
    role: "editor",
    workspaces: ["leads"],
    scope: { workspace: "leads", access: "write" },
  });
  fs.writeFileSync(file, JSON.stringify(keys));
  // the lookup the rate gate uses
  assert.equal(await apiKeyFor(presented), null);
  // and the one every route uses
  const got = await resolveTenant(new NextRequest("http://x/api/workspaces", { headers: { authorization: `Bearer ${presented}` } }));
  assert.equal(got.tenant, null);
  assert.equal(got.status, 403);
  assert.match(got.message ?? "", /deploy key/);
  await assert.rejects(createApiKey("acme", "new", "me@acme.test", { workspace: "leads", access: "write" }, "editor", ["leads"]), /deploy keys went/);
});
