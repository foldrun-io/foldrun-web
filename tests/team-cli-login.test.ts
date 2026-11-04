// A person's own `foldrun login` key manages the team and their profile
// (owner decision, 4 Nov 2026): invite, change a role or workspaces, remove,
// name, timezone. It acts at the lower of the key's role and the person's
// now — an owner's key is an admin — in the workspaces both allow. Every
// other key is still refused, and transfer stays a signed-in session's.
//
//   node --import ./tests/register.mjs --test tests/team-cli-login.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-team-cli-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { createApiKey } = await import("../server/auth.ts");
const { createUser, findUserById, listMembers, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const teamRoute = await import("../app/api/team/route.ts");
const memberRoute = await import("../app/api/team/members/[id]/route.ts");
const nameRoute = await import("../app/api/auth/name/route.ts");
const tzRoute = await import("../app/api/auth/timezone/route.ts");
const meRoute = await import("../app/api/me/route.ts");
const transferRoute = await import("../app/api/team/transfer/route.ts");

const PW = "a long and unusual passphrase 42!";
const tenant = "cli-co";
const owner = await createUser("owner@cli.test", PW, tenant);
const admin = await createUser("admin@cli.test", PW, tenant, { joining: true, role: "admin" });
const editor = await createUser("editor@cli.test", PW, tenant, { joining: true, role: "editor" });

const cliKey = async (email: string, role: "admin" | "editor" | "viewer", workspaces: string[] | null = null) =>
  (await createApiKey(tenant, "cli · laptop", email, undefined, role, workspaces, { origin: "cli-login", expiresAt: new Date(Date.now() + 86_400_000) })).key;
const ownerCli = await cliKey(owner.email, "admin");
const adminCli = await cliKey(admin.email, "admin");
const manual = (await createApiKey(tenant, "ci", owner.email, undefined, "admin", null)).key;

const req = (key: string | null, method: string, p: string, body?: unknown, cookie?: string) =>
  new NextRequest(`http://localhost:3900${p}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost:3900",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const roleOf = async (id: string) => (await listMembers(tenant)).find((m) => m.id === id)?.role;

test("an owner's foldrun login key invites an editor, and is refused an admin invite (it acts as admin)", async () => {
  const ok = await teamRoute.POST(req(ownerCli, "POST", "/api/team", { role: "editor", send: false }));
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.match((await ok.json()).path, /^\/signup\?invite=/);
  const refused = await teamRoute.POST(req(ownerCli, "POST", "/api/team", { role: "admin", send: false }));
  assert.equal(refused.status, 403);
});

test("a key made by hand is still refused every team write and profile change", async () => {
  assert.equal((await teamRoute.POST(req(manual, "POST", "/api/team", { role: "viewer", send: false }))).status, 401);
  assert.equal((await memberRoute.PATCH(req(manual, "PATCH", `/api/team/members/${editor.id}`, { role: "viewer" }), params(editor.id))).status, 401);
  assert.equal((await memberRoute.DELETE(req(manual, "DELETE", `/api/team/members/${editor.id}`), params(editor.id))).status, 401);
  assert.equal((await nameRoute.POST(req(manual, "POST", "/api/auth/name", { firstName: "X" }))).status, 401);
  assert.equal((await tzRoute.POST(req(manual, "POST", "/api/auth/timezone", { timezone: "UTC" }))).status, 401);
});

test("a key decides a request it is on: a hand-made key beside the owner's cookie is still refused", async () => {
  const cookie = `${SESSION_COOKIE}=${(await mintSession(owner)).value}`;
  assert.equal((await nameRoute.POST(req(manual, "POST", "/api/auth/name", { firstName: "X" }, cookie))).status, 401);
  assert.equal((await nameRoute.POST(req(null, "POST", "/api/auth/name", { firstName: "Own" }, cookie))).status, 200, "the cookie alone still works");
});

test("an owner's key changes an editor's role, but cannot make or unmake an admin", async () => {
  const down = await memberRoute.PATCH(req(ownerCli, "PATCH", `/api/team/members/${editor.id}`, { role: "viewer" }), params(editor.id));
  assert.equal(down.status, 200, await down.clone().text());
  assert.equal(await roleOf(editor.id), "viewer");
  const up = await memberRoute.PATCH(req(ownerCli, "PATCH", `/api/team/members/${editor.id}`, { role: "admin" }), params(editor.id));
  assert.equal(up.status, 403);
  assert.equal(await roleOf(editor.id), "viewer");
  const unmake = await memberRoute.PATCH(req(ownerCli, "PATCH", `/api/team/members/${admin.id}`, { role: "editor" }), params(admin.id));
  assert.equal(unmake.status, 403);
  assert.equal(await roleOf(admin.id), "admin");
  const scope = await memberRoute.PATCH(req(ownerCli, "PATCH", `/api/team/members/${admin.id}`, { workspaces: [] }), params(admin.id));
  assert.equal(scope.status, 403, "nor narrow another admin's workspaces");
});

test("an owner's key cannot remove an admin; an admin's key removes an editor", async () => {
  const gone = await createUser("leaver@cli.test", PW, tenant, { joining: true, role: "editor" });
  assert.equal((await memberRoute.DELETE(req(ownerCli, "DELETE", `/api/team/members/${admin.id}`), params(admin.id))).status, 403);
  assert.equal(await roleOf(admin.id), "admin");
  const r = await memberRoute.DELETE(req(adminCli, "DELETE", `/api/team/members/${gone.id}`), params(gone.id));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(await roleOf(gone.id), undefined);
});

test("a key scoped to some workspaces acts only inside them", async () => {
  const scoped = await cliKey(admin.email, "admin", ["desk-a"]);
  const r = await teamRoute.POST(req(scoped, "POST", "/api/team", { role: "viewer", send: false }));
  assert.equal(r.status, 403, "an invite for every workspace is wider than the key");
});

test("a key that reaches beyond the person's standing now acts at the person's", async () => {
  const p = await createUser("demoted@cli.test", PW, tenant, { joining: true, role: "editor" });
  // An admin key for an editor (FOL-97 would revoke it; here it is made so).
  const k = await cliKey(p.email, "admin");
  assert.equal((await teamRoute.POST(req(k, "POST", "/api/team", { role: "viewer", send: false }))).status, 403, "an editor cannot invite");
});

test("a key older than its person's account is not theirs: a reused address inherits nothing", async () => {
  const k = await cliKey("late@cli.test", "admin");
  await new Promise((r) => setTimeout(r, 5));
  await createUser("late@cli.test", PW, tenant, { joining: true, role: "admin" });
  assert.equal((await teamRoute.POST(req(k, "POST", "/api/team", { role: "viewer", send: false }))).status, 401);
  assert.equal((await nameRoute.POST(req(k, "POST", "/api/auth/name", { firstName: "Late" }))).status, 401);
});

test("the key's person sets their name and timezone, and /api/me shows them", async () => {
  const n = await nameRoute.POST(req(adminCli, "POST", "/api/auth/name", { firstName: "Ada", lastName: "Admin" }));
  assert.equal(n.status, 200, await n.clone().text());
  const t = await tzRoute.POST(req(adminCli, "POST", "/api/auth/timezone", { timezone: "Australia/Sydney" }));
  assert.equal(t.status, 200, await t.clone().text());
  const u = await findUserById(admin.id);
  assert.equal(u?.firstName, "Ada");
  assert.equal(u?.timezone, "Australia/Sydney");
  const me = await (await meRoute.GET(req(adminCli, "GET", "/api/me"))).json();
  assert.deepEqual(me.person, { email: admin.email, firstName: "Ada", lastName: "Admin", timezone: "Australia/Sydney" });
  const hand = await (await meRoute.GET(req(manual, "GET", "/api/me"))).json();
  assert.equal(hand.person, null, "a key made by hand is nobody");
  assert.equal((await tzRoute.POST(req(adminCli, "POST", "/api/auth/timezone", { timezone: "Not/AZone" }))).status, 400);
});

test("transfer stays a signed-in session's", async () => {
  const { ownerOf } = await import("../server/users.ts");
  const r = await transferRoute.POST(req(ownerCli, "POST", "/api/team/transfer", { to: admin.id, password: PW }));
  assert.ok(r.status === 401 || r.status === 403, `refused, not ${r.status}`);
  assert.equal((await ownerOf(tenant))?.id, owner.id);
});

test("a key made by hand cannot become a person by rotating someone's foldrun login key", async () => {
  const rotateRoute = await import("../app/api/keys/[id]/rotate/route.ts");
  const { listApiKeys } = await import("../server/auth.ts");
  const made = await createApiKey(tenant, "cli · other", admin.email, undefined, "admin", null, { origin: "cli-login", expiresAt: new Date(Date.now() + 86_400_000) });
  const r = await rotateRoute.POST(req(manual, "POST", `/api/keys/${made.record.id}/rotate`, { grace: "0" }), params(made.record.id));
  assert.equal(r.status, 200, await r.clone().text());
  const rotated = await r.json();
  const rec = (await listApiKeys(tenant)).find((k) => k.id === rotated.id);
  assert.equal(rec?.origin, undefined, "the replacement is an ordinary key");
  assert.equal((await teamRoute.POST(req(rotated.key, "POST", "/api/team", { role: "viewer", send: false }))).status, 401);
  assert.equal((await nameRoute.POST(req(rotated.key, "POST", "/api/auth/name", { firstName: "Mallory" }))).status, 401);
});

test("the person rotating their own foldrun login key, signed in, keeps it theirs", async () => {
  const rotateRoute = await import("../app/api/keys/[id]/rotate/route.ts");
  const { listApiKeys } = await import("../server/auth.ts");
  const made = await createApiKey(tenant, "cli · mine", admin.email, undefined, "admin", null, { origin: "cli-login", expiresAt: new Date(Date.now() + 86_400_000) });
  const cookie = `${SESSION_COOKIE}=${(await mintSession(admin)).value}`;
  const r = await rotateRoute.POST(req(null, "POST", `/api/keys/${made.record.id}/rotate`, { grace: "0" }, cookie), params(made.record.id));
  assert.equal(r.status, 200, await r.clone().text());
  const rotated = await r.json();
  assert.equal((await listApiKeys(tenant)).find((k) => k.id === rotated.id)?.origin, "cli-login");
});
