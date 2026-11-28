// One login, several accounts (FOL-464): the gate. Before anyone can hold a
// second membership, these hold: a person who joins account B is, in B, what
// B's invite made them and nothing their first account made them; a session
// is for one account; leaving B ends B only.
//
// File mode — the store's two halves are platform tests/people.test.ts.
//
//   node --import ./tests/register.mjs --test tests/one-login-several-accounts.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-several-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const U = await import("../server/users.ts");
const { createApiKey } = await import("../server/auth.ts");
const { saveWorkspace, templateFiles } = await import("@/lib/store.ts");
const teamRoute = await import("../app/v1/team/route.ts");
const memberRoute = await import("../app/v1/team/members/[id]/route.ts");
const meRoute = await import("../app/v1/me/route.ts");
const wsRoute = await import("../app/v1/workspaces/route.ts");

const PW = "a long and unusual passphrase 42!";
const BASE = "http://localhost:3900";

// ana owns ana-co. bo owns shop, which has two projects.
const ana = await U.createUser("ana@several.test", PW, "ana-co", { request: "free" });
const bo = await U.createUser("bo@several.test", PW, "shop", { request: "free" });
await U.setEmailVerified(ana.id);
await U.setEmailVerified(bo.id);
saveWorkspace("ana-co", "home", templateFiles("home"));
saveWorkspace("shop", "desk", templateFiles("home"));
saveWorkspace("shop", "vault", templateFiles("home"));

const cookieOf = async (u: Parameters<typeof U.mintSession>[0]) => `${U.SESSION_COOKIE}=${(await U.mintSession(u)).value}`;
const req = (method: string, p: string, cookie: string, body?: unknown) =>
  new NextRequest(`${BASE}${p}`, { method, headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const inviteTo = async (tenant: string, by: { id: string; email: string }, email: string | null, role: "viewer" | "editor" | "admin", workspaces: string[] | null = null) =>
  (await U.mintInvite(tenant, role, { email, workspaces, by })).token;

test("joining: the invite's role and projects, nothing from the first account", async () => {
  const token = await inviteTo("shop", bo, ana.email, "viewer", ["desk"]);
  const { user } = await U.joinAccount(token, ana.id);
  assert.equal(user.tenant, "shop");
  assert.equal(user.id, ana.id, "the same login");
  assert.equal(user.role, "viewer");
  assert.equal(user.owner, undefined);
  assert.deepEqual(user.workspaces, ["desk"]);

  assert.equal(await U.roleOfUser("shop", ana.id), "viewer", "the owner of ana-co is a viewer of shop");
  assert.equal(await U.isOwner("shop", ana.id), false);
  assert.deepEqual(await U.allowedWorkspaces("shop", ana.id), ["desk"]);
  assert.equal(await U.roleOfUser("ana-co", ana.id), "owner", "and still owns their own");
  assert.equal(await U.allowedWorkspaces("ana-co", ana.id), null);
  assert.equal((await U.ownerOf("shop"))?.id, bo.id, "shop's owner is who it was");

  assert.deepEqual((await U.accountsOf(ana.id)).map((a) => `${a.tenant}:${a.role}`), ["ana-co:owner", "shop:viewer"]);
  assert.deepEqual((await U.listMembers("shop")).map((m) => `${m.email}:${m.role}`).sort(), ["ana@several.test:viewer", "bo@several.test:owner"]);
  assert.deepEqual((await U.listMembers("ana-co")).map((m) => m.email), ["ana@several.test"]);

  // Stored once: one person, with the joined account beside them.
  const stored = U.readUsersFile() as { id: string; tenant: string; also?: { tenant: string }[] }[];
  assert.equal(stored.filter((p) => p.id === ana.id).length, 1);
  assert.deepEqual(stored.find((p) => p.id === ana.id)!.also!.map((m) => m.tenant), ["shop"]);
  // Signing in finds the one login, in their first account.
  assert.equal((await U.verifyPassword(ana.email, PW))?.tenant, "ana-co");
  assert.equal((await U.findUser(ana.email))?.tenant, "ana-co");
});

test("a session is for one account: in shop it acts as a viewer there, in ana-co as the owner", async () => {
  const home = await U.findMember("ana-co", { id: ana.id });
  const inShop = await U.findMember("shop", { id: ana.id });
  assert.ok(home && inShop);
  const homeCookie = await cookieOf(home);
  const shopCookie = await cookieOf(inShop);
  assert.notEqual(homeCookie, shopCookie);

  const me = async (cookie: string) => (await (await meRoute.GET(req("GET", "/v1/me", cookie))).json()) as { account: string; role: string; workspaces: string[] | null };
  assert.deepEqual(await me(homeCookie), { ...(await me(homeCookie)), account: "ana-co", role: "owner", workspaces: null });
  const there = await me(shopCookie);
  assert.equal(there.account, "shop");
  assert.equal(there.role, "viewer");
  assert.deepEqual(there.workspaces, ["desk"]);

  // The projects each session lists: its own account's, inside its scope.
  const names = async (cookie: string) => ((await (await wsRoute.GET(req("GET", "/v1/workspaces", cookie))).json()) as { workspaces: { name: string }[] }).workspaces.map((w) => w.name).sort();
  assert.deepEqual(await names(homeCookie), ["home"]);
  assert.deepEqual(await names(shopCookie), ["desk"], "not vault, and nothing of ana-co");

  // A viewer of shop invites nobody there, though they own another account.
  const r = await teamRoute.POST(req("POST", "/v1/team", shopCookie, { email: "x@several.test", role: "viewer", workspaces: ["desk"], send: false }));
  assert.equal(r.status, 403);
  // Nor removes shop's owner.
  const d = await memberRoute.DELETE(req("DELETE", `/v1/team/members/${bo.id}`, shopCookie), { params: Promise.resolve({ id: bo.id }) });
  assert.ok([400, 403].includes(d.status), `refused (${d.status})`);
  assert.equal((await U.ownerOf("shop"))?.id, bo.id);
  // And a key for shop cannot be minted in their name above what they are there.
  await assert.rejects(createApiKey("shop", "k", ana.email, undefined, "admin", null, { personBound: { credential: { user: ana.id }, permission: "keys:manage" } as never }), /./);
});

test("the join is refused, and the invite stays, for the wrong person, an unconfirmed address, or twice", async () => {
  const cy = await U.createUser("cy@several.test", PW, "cy-co", { request: "free" });
  process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION = "1";
  try {
    const forCy = await inviteTo("shop", bo, cy.email, "editor");
    await assert.rejects(U.joinAccount(forCy, ana.id), /sent to cy@several\.test/, "another signed-in person cannot take it");
    await assert.rejects(U.joinAccount(forCy, cy.id), /confirm/i, "an unconfirmed address proves nothing");
    assert.ok(await U.peekInvite(forCy), "still pending for the right person");
    await U.setEmailVerified(cy.id);
    assert.equal((await U.joinAccount(forCy, cy.id)).user.role, "editor");
    await assert.rejects(U.joinAccount(forCy, cy.id), /no longer valid/, "a link works once");

    const again = await inviteTo("shop", bo, ana.email, "admin");
    await assert.rejects(U.joinAccount(again, ana.id), /already in shop/);
    assert.equal(await U.roleOfUser("shop", ana.id), "viewer", "a second invite does not raise a member");
    assert.ok(await U.peekInvite(again), "and is not used up");
  } finally {
    delete process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION;
  }
});

test("an invite whose maker has since lost the right to make it lets nobody in", async () => {
  const dee = await U.createUser("dee@several.test", PW, "dee-co", { request: "free" });
  await U.setEmailVerified(dee.id);
  // cy is an editor of shop: raise to admin, invite, then lower again.
  await U.setMemberRole("shop", (await U.findMember("shop", { email: "cy@several.test" }))!.id, "admin", bo.id);
  const cy = (await U.findMember("shop", { email: "cy@several.test" }))!;
  const token = await inviteTo("shop", { id: cy.id, email: cy.email }, dee.email, "editor");
  await U.setMemberRole("shop", cy.id, "viewer", bo.id);
  await assert.rejects(U.joinAccount(token, dee.id), /no longer valid/);
  assert.equal(await U.findMember("shop", { id: dee.id }), null);
});

test("removed from the joined account: that session ends, the login and the first account stay", async () => {
  const inShop = (await U.findMember("shop", { id: ana.id }))!;
  const shopToken = (await U.mintSession(inShop)).value;
  const homeToken = (await U.mintSession((await U.findMember("ana-co", { id: ana.id }))!)).value;
  assert.equal((await U.verifySession(shopToken))?.tenant, "shop");

  assert.ok(await U.removeMember("shop", ana.id, bo.id));
  assert.equal(await U.verifySession(shopToken), null, "the session for shop is nobody's now");
  assert.equal((await U.verifySession(homeToken))?.tenant, "ana-co");
  assert.equal(await U.findMember("shop", { id: ana.id }), null);
  assert.equal((await U.verifyPassword(ana.email, PW))?.id, ana.id, "the login is untouched");
  assert.deepEqual((await U.accountsOf(ana.id)).map((a) => a.tenant), ["ana-co"]);
});

test("the person's own things are one: a new password, in any account, is the login's", async () => {
  const token = await inviteTo("shop", bo, ana.email, "editor");
  await U.joinAccount(token, ana.id);
  const NEW = "another long unusual passphrase 77?";
  await U.changePassword(ana.id, PW, NEW);
  assert.equal(await U.verifyPassword(ana.email, PW), null);
  assert.equal((await U.verifyPassword(ana.email, NEW))?.id, ana.id);
  for (const t of ["ana-co", "shop"]) assert.equal((await U.findMember(t, { id: ana.id }))?.hash, (await U.findUser(ana.email))?.hash, `${t} sees the same login`);
  // A changed address is the person's everywhere.
  await U.changeEmail(ana.id, "ana2@several.test");
  assert.equal((await U.findMember("shop", { id: ana.id }))?.email, "ana2@several.test");
  assert.equal(await U.findMember("shop", { email: ana.email }), null);
});

test("removed from their FIRST account while in another: the login lives on in the other, with only its rights there", async () => {
  // eli owns eli-co, joins shop as a viewer; then eli-co's ownership moves and eli is removed from eli-co.
  const eli = await U.createUser("eli@several.test", PW, "eli-co", { request: "free" });
  await U.setEmailVerified(eli.id);
  await U.joinAccount(await inviteTo("shop", bo, eli.email, "viewer", ["desk"]), eli.id);
  const fay = (await U.acceptInvite(await inviteTo("eli-co", eli, "fay@several.test", "admin"), "fay@several.test", PW)).user;
  await U.transferOwnership("eli-co", fay.id, eli.id);
  assert.ok(await U.removeMember("eli-co", eli.id, fay.id));

  assert.deepEqual((await U.accountsOf(eli.id)).map((a) => `${a.tenant}:${a.role}`), ["shop:viewer"]);
  const now = await U.findUser(eli.email);
  assert.equal(now?.tenant, "shop");
  assert.equal(now?.owner, undefined);
  assert.equal(now?.joined, undefined, "shop is their first account now");
  assert.deepEqual(await U.allowedWorkspaces("shop", eli.id), ["desk"]);
  assert.equal((await U.ownerOf("shop"))?.id, bo.id, "and they did not become shop's owner by being its oldest record");
  assert.equal((await U.verifyPassword(eli.email, PW))?.tenant, "shop");
});

test("a session is for the membership as it was: leaving and being let back in does not revive it, and a first account that moves does not carry one over", async () => {
  const gus = await U.createUser("gus@several.test", PW, "gus-co", { request: "free" });
  await U.setEmailVerified(gus.id);
  await U.joinAccount(await inviteTo("shop", bo, gus.email, "viewer"), gus.id);
  const oldShop = (await U.mintSession((await U.findMember("shop", { id: gus.id }))!)).value;
  const oldHome = (await U.mintSession((await U.findMember("gus-co", { id: gus.id }))!)).value;
  assert.match(oldShop, /^v3\./, "a joined account's session is marked, so a release from before them refuses it");
  assert.match(oldHome, /^v1\./);

  assert.ok(await U.removeMember("shop", gus.id, bo.id));
  await U.joinAccount(await inviteTo("shop", bo, gus.email, "admin"), gus.id);
  assert.equal(await U.verifySession(oldShop), null, "the session from before they left stays dead");
  assert.equal((await U.verifySession((await U.mintSession((await U.findMember("shop", { id: gus.id }))!)).value))?.role, "admin");

  // Their first account goes: the session made for it is not a session for the one that remains.
  const hal = (await U.acceptInvite(await inviteTo("gus-co", gus, "hal@several.test", "admin"), "hal@several.test", PW)).user;
  await U.transferOwnership("gus-co", hal.id, gus.id);
  assert.ok(await U.removeMember("gus-co", gus.id, hal.id));
  assert.equal((await U.findUser(gus.email))?.tenant, "shop");
  assert.equal(await U.verifySession(oldHome), null, "a gus-co session never opens shop");
});

test("the invite page knows a member who joined: 'already in', not 'has a login elsewhere'", async () => {
  const ivy = await U.createUser("ivy@several.test", PW, "ivy-co", { request: "free" });
  await U.setEmailVerified(ivy.id);
  assert.equal(await U.inviteDoor({ tenant: "shop", email: ivy.email }), "elsewhere");
  await U.joinAccount(await inviteTo("shop", bo, ivy.email, "viewer"), ivy.id);
  assert.equal(await U.inviteDoor({ tenant: "shop", email: ivy.email }), "member");
  assert.equal(await U.inviteDoor({ tenant: "ivy-co", email: ivy.email }), "member");
});

test("an address still to be confirmed is held back in a joined account as in their own", async () => {
  const { assertActorConfirmed } = await import("../server/email-confirmed.ts");
  const jo = await U.createUser("jo@several.test", PW, "jo-co", { request: "free" });
  await U.setEmailVerified(jo.id);
  await U.joinAccount(await inviteTo("shop", bo, jo.email, "editor"), jo.id);
  await U.changeEmail(jo.id, "jo2@several.test"); // unconfirmed again
  process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION = "1";
  try {
    await assert.rejects(assertActorConfirmed("shop", { kind: "user", id: jo.id, name: "jo2@several.test" }), /confirm/i);
    await assert.rejects(assertActorConfirmed("shop", { kind: "key", id: "k", name: "jo2@several.test" }), /confirm/i);
  } finally {
    delete process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION;
  }
});
