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
import crypto from "node:crypto";
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

process.env.FOLDRUN_RESEND_API_KEY = "re_test"; // the install sends its own sign-in mail (joinAccount asks)
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
/** A pending invite to someone who is a member by now. Nobody can make one
 *  (the form answers "already a member"), so it is one that was out before
 *  they joined: a row, as the store would hold it. */
const staleInviteTo = async (tenant: string, by: { id: string; email: string }, email: string, role: "viewer" | "editor" | "admin") => {
  const { readInvitesFile, writeInvitesFile } = await import("@/platform/invites.ts");
  const id = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  writeInvitesFile([...readInvitesFile(), { id, tenant, role, workspaces: null, email, createdBy: by.id, createdByEmail: by.email, createdAt: new Date().toISOString(), expiresAt, usedAt: null, usedBy: null, revokedAt: null, revokedBy: null, revokeReason: null }]);
  return decodeURIComponent(U.invitePath({ id, expiresAt }).split("invite=")[1]);
};

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

    await assert.rejects(inviteTo("shop", bo, ana.email, "admin"), /already a member of this account/, "the form says so, and makes nothing");
    const again = await staleInviteTo("shop", bo, ana.email, "admin");
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

test("a joined account's session is signed under its own name: relabelled as an older kind, it is nothing", async () => {
  const kim = await U.createUser("kim@several.test", PW, "kim-co", { request: "free" });
  await U.setEmailVerified(kim.id);
  await U.joinAccount(await inviteTo("shop", bo, kim.email, "viewer"), kim.id);
  const shop = (await U.mintSession((await U.findMember("shop", { id: kim.id }))!)).value;
  assert.equal((await U.verifySession(shop))?.tenant, "shop");
  // What a release from before joined accounts would be handed: the same bytes, called v1.
  const [, subject, expires, mac] = shop.split(".");
  assert.equal(await U.verifySession(`v1.${subject}.${expires}.${mac}`), null);
  assert.equal(await U.verifySession(`v2.${subject}.${expires}.${mac}`), null);
  // And a first-account cookie from before any of this (no stay named) is the first account's only.
  const home = (await U.mintSession((await U.findMember("kim-co", { id: kim.id }))!)).value;
  assert.equal(home.split(".")[1].split(":").length, 2, "the form it always had");
  assert.equal((await U.verifySession(home))?.tenant, "kim-co");
});

test("with no mail sender of the install's own, nobody joins a second account", async () => {
  const lee = await U.createUser("lee@several.test", PW, "lee-co", { request: "free" });
  await U.setEmailVerified(lee.id);
  const token = await inviteTo("shop", bo, lee.email, "viewer");
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    await assert.rejects(U.joinAccount(token, lee.id), /mail sender/);
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = "re_test";
  }
  assert.equal((await U.joinAccount(token, lee.id)).user.tenant, "shop", "the refusal left the invite pending");
});

// ---- the door (step 3): POST /v1/auth/session moves a session, or joins and moves

const sessionRoute = await import("../app/v1/auth/session/route.ts");
const setCookieOf = (res: Response) => /foldrun_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
const sessionPost = (cookie: string, body: unknown) =>
  sessionRoute.POST(new NextRequest(`${BASE}/v1/auth/session`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: `${U.SESSION_COOKIE}=${cookie}` }, body: JSON.stringify(body) }));
const whoAmI = async (cookie: string) =>
  ((await (await sessionRoute.GET(new NextRequest(`${BASE}/v1/auth/session`, { headers: { cookie: `${U.SESSION_COOKIE}=${cookie}` } }))).json()) as { user: { tenant: string; role: string; accounts: { tenant: string; role: string; current: boolean }[] } | null }).user;

test("a signed-in person joins from an invite with the login they have, and the session moves there", async () => {
  const mia = await U.createUser("mia@several.test", PW, "mia-co", { request: "free" });
  await U.setEmailVerified(mia.id);
  const home = (await U.mintSession(mia)).value;
  assert.deepEqual((await whoAmI(home))!.accounts, [{ tenant: "mia-co", role: "owner", current: true }]);

  const res = await sessionPost(home, { invite: await inviteTo("shop", bo, mia.email, "editor", ["desk"]) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(((await res.json()) as { tenant: string }).tenant, "shop");
  const inShop = setCookieOf(res)!;
  assert.ok(inShop && inShop !== home);
  const me = (await whoAmI(inShop))!;
  assert.equal(me.tenant, "shop");
  assert.equal(me.role, "editor", "the invite's role, not the owner they are at home");
  assert.deepEqual(me.accounts, [{ tenant: "mia-co", role: "owner", current: false }, { tenant: "shop", role: "editor", current: true }]);

  // And back: to an account they are in.
  const back = await sessionPost(inShop, { account: "mia-co" });
  assert.equal(back.status, 200);
  assert.equal((await whoAmI(setCookieOf(back)!))!.tenant, "mia-co");

  // Not theirs: an account they are not in reads as one that does not exist.
  assert.equal((await sessionPost(inShop, { account: "ana-co" })).status, 404);
  assert.equal((await sessionPost(inShop, { account: "no-such-account" })).status, 404);
  // Neither, both, or not text: refused before anything is read.
  assert.equal((await sessionPost(inShop, {})).status, 400);
  assert.equal((await sessionPost(inShop, { account: "mia-co", invite: "x" })).status, 400);
  assert.equal((await sessionPost(inShop, { account: { $ne: "" } })).status, 400);
  // No session, no move.
  assert.equal((await sessionPost("not-a-session", { account: "shop" })).status, 401);
});

test("an invite for another address, a used one, or one for an account they are in: refused, and the session stays where it was", async () => {
  const ned = await U.createUser("ned@several.test", PW, "ned-co", { request: "free" });
  await U.setEmailVerified(ned.id);
  const home = (await U.mintSession(ned)).value;
  const others = await sessionPost(home, { invite: await inviteTo("shop", bo, "someone-else@several.test", "admin") });
  assert.equal(others.status, 403);
  assert.equal(setCookieOf(others), null, "no new session on a refusal");
  const token = await inviteTo("shop", bo, ned.email, "viewer");
  assert.equal((await sessionPost(home, { invite: token })).status, 200);
  assert.ok([400, 404, 409, 410].includes((await sessionPost(home, { invite: token })).status), "the link works once");
  assert.equal((await sessionPost(home, { invite: await staleInviteTo("shop", bo, ned.email, "admin") })).status, 409, "already in: no second membership, no raised role");
  assert.equal(await U.roleOfUser("shop", ned.id), "viewer");
  assert.equal((await whoAmI(home))!.tenant, "ned-co");
});

test("a page showing one account cannot write into another the session has since moved to", async () => {
  const oli = await U.createUser("oli@several.test", PW, "oli-co", { request: "free" });
  await U.setEmailVerified(oli.id);
  await U.joinAccount(await inviteTo("shop", bo, oli.email, "admin"), oli.id);
  const inShop = (await U.mintSession((await U.findMember("shop", { id: oli.id }))!)).value;
  const { resolveTenant: resolveCaller } = await import("../server/auth.ts");
  const ask = (method: string, shown?: string) =>
    resolveCaller(new NextRequest(`${BASE}/v1/account/pause`, { method, headers: { cookie: `${U.SESSION_COOKIE}=${inShop}`, origin: BASE, ...(shown ? { "x-foldrun-tenant": shown } : {}) } }));
  const stale = await ask("POST", "oli-co");
  assert.equal(stale.tenant, null);
  assert.equal((stale as { status: number }).status, 412, "the tab still shows oli-co; the session is in shop");
  const exact = (shown: string) => resolveCaller(new NextRequest(`${BASE}/v1/account/pause`, { method: "POST", headers: { cookie: `${U.SESSION_COOKIE}=${inShop}`, origin: BASE, "x-foldrun-account": shown } }));
  assert.equal((await exact("default") as { status: number }).status, 412, "the exact header is literal: a page of the default account is refused too");
  assert.equal((await exact("shop")).tenant, "shop");
  assert.equal((await ask("POST", "shop")).tenant, "shop");
  assert.equal((await ask("POST")).tenant, "shop", "a request that names no account is the session's");
  assert.equal((await ask("GET", "oli-co")).tenant, "shop", "a read is only a read");
});

test("a consent or a join pressed on a page that showed another account, or another person, is refused", async () => {
  const pia = await U.createUser("pia@several.test", PW, "pia-co", { request: "free" });
  await U.setEmailVerified(pia.id);
  await U.joinAccount(await inviteTo("shop", bo, pia.email, "admin"), pia.id);
  const inShop = (await U.mintSession((await U.findMember("shop", { id: pia.id }))!)).value;
  const post = async (route: { POST: (r: NextRequest) => Promise<Response | undefined> }, p: string, body: unknown, headers: Record<string, string>) =>
    (await route.POST(new NextRequest(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: `${U.SESSION_COOKIE}=${inShop}`, ...headers }, body: JSON.stringify(body) })))!;
  // The page asked "let this CLI into pia-co"; the browser is in shop now.
  const cli = await import("../app/v1/cli/authorize/route.ts");
  const mcp = await import("../app/v1/mcp/oauth/authorize/route.ts");
  for (const res of [
    await post(cli, "/v1/cli/authorize", { code: "ABCD-EFGH", decision: "approve" }, { "x-foldrun-account": "pia-co" }),
    await post(mcp, "/v1/mcp/oauth/authorize", { request: "x", decision: "approve", access: "read", workspaces: null }, { "x-foldrun-account": "pia-co" }),
    await post(sessionRoute, "/v1/auth/session", { account: "pia-co" }, { "x-foldrun-account": "pia-co" }),
    await post(sessionRoute, "/v1/auth/session", { account: "pia-co", as: bo.id }, { "x-foldrun-account": "shop" }),
    // The right account, but the page showed another person of it (bo, signed in on this tab before).
    await post(cli, "/v1/cli/authorize", { code: "ABCD-EFGH", decision: "approve" }, { "x-foldrun-account": "shop", "x-foldrun-as": bo.id }),
    await post(mcp, "/v1/mcp/oauth/authorize", { request: "x", decision: "approve", access: "read", workspaces: null }, { "x-foldrun-account": "shop", "x-foldrun-as": bo.id }),
    // The right account and person, but the page was drawn when they were a viewer here; they are an admin now.
    await post(cli, "/v1/cli/authorize", { code: "ABCD-EFGH", decision: "approve", shown: { role: "viewer" } }, { "x-foldrun-account": "shop", "x-foldrun-as": pia.id }),
  ]) {
    assert.equal(res.status, 412);
    assert.equal(((await res.json()) as { code?: string }).code, "account_moved");
  }
  assert.equal((await whoAmI(inShop))?.tenant, "shop", "nothing moved");
  // Named as it is, the move goes through.
  assert.equal((await post(sessionRoute, "/v1/auth/session", { account: "pia-co", as: pia.id }, { "x-foldrun-account": "shop" })).status, 200);
});

test("a reset link mailed before they joined another account is spent by the join", async () => {
  const { resetLink } = await import("../server/auth-flows.ts");
  const reset = await import("../app/v1/auth/reset/route.ts");
  const pat = await U.createUser("pat@several.test", PW, "pat-co", { request: "free" });
  await U.setEmailVerified(pat.id);
  const tokenOf = (u: Parameters<typeof resetLink>[1]) => new URL(resetLink(BASE, u)).searchParams.get("token")!;
  const before = tokenOf((await U.findUser(pat.email))!);
  // Joined in the same millisecond or a later one: the link names how many accounts the login had opened, not a time.
  await U.joinAccount(await inviteTo("shop", bo, pat.email, "viewer"), pat.id);
  const post = (token: string) => reset.POST(new NextRequest(`${BASE}/v1/auth/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "another-Long-Passphrase-77!" }) }));
  assert.equal((await post(before)).status, 400, "mailed before the join");
  // Their first account goes and the joined one becomes their first: the old link stays spent.
  const quin = (await U.acceptInvite(await inviteTo("pat-co", pat, "quin@several.test", "admin"), "quin@several.test", PW)).user;
  await U.transferOwnership("pat-co", quin.id, pat.id);
  assert.ok(await U.removeMember("pat-co", pat.id, quin.id));
  assert.equal((await post(before)).status, 400, "and after the first account is gone");
  assert.equal((await post(tokenOf((await U.findUser(pat.email))!))).status, 200, "one asked for since works");
});
