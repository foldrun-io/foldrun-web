// A person's API keys follow their standing in the account (FOL-97): removed
// from the team, every key they minted stops at once — a `foldrun login`
// key and one made by hand alike; a lower role or fewer workspaces, the
// keys that would reach more than they now can stop too.
//
//   node --import ./tests/register.mjs --test tests/team-keys.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-team-keys-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { createApiKey, listApiKeys, resolveTenant } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const memberRoute = await import("../app/api/team/members/[id]/route.ts");

const PW = "a long and unusual passphrase 42!";
const tenant = "keys-co";
const owner = await createUser("owner@keys.test", PW, tenant);
const ownerCookie = `${SESSION_COOKIE}=${(await mintSession(owner)).value}`;
const asOwner = (method: string, p: string, body?: unknown) =>
  new NextRequest(`http://localhost:3900${p}`, { method, headers: { cookie: ownerCookie, origin: "http://localhost:3900", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
// A key works when the auth funnel names an account for it (a refusal
// answers { tenant: null, status }).
const works = async (key: string) =>
  (await resolveTenant(new NextRequest("http://localhost:3900/api/workspaces", { headers: { authorization: `Bearer ${key}` } }))).tenant !== null;

test("removing a member stops every key they minted — the CLI's and a manual one — right away", async () => {
  const member = await createUser("dev@keys.test", PW, tenant, { joining: true, role: "admin" });
  const cli = await createApiKey(tenant, "cli · laptop", member.email, undefined, "admin", null);
  const manual = await createApiKey(tenant, "ci", member.email, undefined, "editor", null);
  const owners = await createApiKey(tenant, "owner's own", owner.email, undefined, "admin", null);
  assert.equal(await works(cli.key), true);
  assert.equal(await works(manual.key), true);

  const r = await memberRoute.DELETE(asOwner("DELETE", `/api/team/members/${member.id}`), { params: Promise.resolve({ id: member.id }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(await works(cli.key), false, "the foldrun login key stops");
  assert.equal(await works(manual.key), false, "the manual key stops");
  assert.equal(await works(owners.key), true, "another person's key is untouched");
  const revoked = (await listApiKeys(tenant)).filter((k) => k.revokedAt).map((k) => k.id).sort();
  assert.deepEqual(revoked, [cli.record.id, manual.record.id].sort());
});

test("a lower role stops the keys above it; a narrower scope stops the keys that reach outside it", async () => {
  const member = await createUser("ops@keys.test", PW, tenant, { joining: true, role: "admin" });
  const adminKey = await createApiKey(tenant, "admin key", member.email, undefined, "admin", null);
  const viewerKey = await createApiKey(tenant, "viewer key", member.email, undefined, "viewer", ["desk-a"]);
  const r = await memberRoute.PATCH(asOwner("PATCH", `/api/team/members/${member.id}`, { role: "viewer" }), { params: Promise.resolve({ id: member.id }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(await works(adminKey.key), false, "admin key above a viewer: stopped");
  assert.equal(await works(viewerKey.key), true, "a viewer key for desk-a still fits");

  const narrowed = await memberRoute.PATCH(asOwner("PATCH", `/api/team/members/${member.id}`, { workspaces: ["desk-b"] }), { params: Promise.resolve({ id: member.id }) });
  assert.equal(narrowed.status, 200, await narrowed.clone().text());
  assert.equal(await works(viewerKey.key), false, "desk-a is no longer theirs: stopped");
});

test("a member who changed their address is still found: their keys stop when they are removed", async () => {
  const { changeEmail } = await import("../server/users.ts");
  const member = await createUser("old@keys.test", PW, tenant, { joining: true, role: "editor" });
  const k = await createApiKey(tenant, "cli · laptop", member.email, undefined, "editor", null);
  await changeEmail(member.id, "new@keys.test");
  const r = await memberRoute.DELETE(asOwner("DELETE", `/api/team/members/${member.id}`), { params: Promise.resolve({ id: member.id }) });
  assert.equal(r.status, 200);
  assert.equal(await works(k.key), false);
});

test("a role saved and a workspace change refused in the same request still stops the keys above the new role", async () => {
  const member = await createUser("half@keys.test", PW, tenant, { joining: true, role: "admin" });
  const k = await createApiKey(tenant, "admin key", member.email, undefined, "admin", null);
  const r = await memberRoute.PATCH(asOwner("PATCH", `/api/team/members/${member.id}`, { role: "viewer", workspaces: "not a list" }), { params: Promise.resolve({ id: member.id }) });
  assert.equal(r.status, 400);
  assert.equal(await works(k.key), false, "the role landed, so its keys above it stop");
});


test("PATCH an unknown member is 404, whatever the body — not 'nothing to change' (30 Oct 2026)", async () => {
  for (const body of [undefined, { role: "viewer" }]) {
    const r = await memberRoute.PATCH(asOwner("PATCH", "/api/team/members/no-such-id", body), { params: Promise.resolve({ id: "no-such-id" }) });
    assert.equal(r.status, 404, await r.clone().text());
  }
  // A known member with an empty body is still told what to send.
  const member = await createUser("idle@keys.test", PW, tenant, { joining: true, role: "editor" });
  const r = await memberRoute.PATCH(asOwner("PATCH", `/api/team/members/${member.id}`), { params: Promise.resolve({ id: member.id }) });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /nothing to change/);
});
