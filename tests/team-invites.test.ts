// Team invites are single-use and revocable (OWASP review, 29 Oct 2026).
// Before, an invite was a signed statement stored nowhere: one link let in
// any number of people for seven days, a removed member rejoined with the
// link they came in on, and nobody could take a link back. Now the link
// names a row, the row is used up in the transaction that creates the
// member, and removal, demotion, a newer invite or a person revoke it.
//
// File mode (no database) — the Postgres half is team-invites-db.test.ts.
//
//   node --import ./tests/register.mjs --test tests/team-invites.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-team-invites-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const { createApiKey } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE, peekInvite, listMembers } = await import("../server/users.ts");
const { installKey } = await import("@/lib/webhook.ts");
const { saveWorkspace, templateFiles } = await import("@/lib/store.ts");
const { readInvitesFile, writeInvitesFile } = await import("@/platform/invites.ts");
const teamRoute = await import("../app/api/team/route.ts");
const invitesRoute = await import("../app/api/team/invites/route.ts");
const inviteRoute = await import("../app/api/team/invites/[id]/route.ts");
const memberRoute = await import("../app/api/team/members/[id]/route.ts");
const signupRoute = await import("../app/api/auth/signup/route.ts");

const PW = "a long and unusual passphrase 42!";
const BASE = "http://localhost:3900";
const tenant = "inv-co";
const owner = await createUser("owner@inv.test", PW, tenant);
saveWorkspace(tenant, "desk-a", templateFiles("home"));
saveWorkspace(tenant, "desk-b", templateFiles("home"));

const cookieOf = async (u: Parameters<typeof mintSession>[0]) => `${SESSION_COOKIE}=${(await mintSession(u)).value}`;
const ownerCookie = await cookieOf(owner);
const req = (method: string, p: string, auth: { cookie?: string; key?: string } = {}, body?: unknown) =>
  new NextRequest(`${BASE}${p}`, {
    method,
    headers: {
      ...(auth.cookie ? { cookie: auth.cookie } : {}),
      ...(auth.key ? { authorization: `Bearer ${auth.key}` } : {}),
      origin: BASE,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

let n = 0;
const fresh = (who = "p") => `${who}${++n}@inv.test`;

async function invite(cookie: string, body: Record<string, unknown> = {}): Promise<{ id: string; token: string; status: number; body: Record<string, unknown> }> {
  const r = await teamRoute.POST(req("POST", "/api/team", { cookie }, { send: false, ...body }));
  const j = (await r.json()) as Record<string, unknown>;
  const token = typeof j.path === "string" ? decodeURIComponent(j.path.split("invite=")[1]) : "";
  return { id: j.id as string, token, status: r.status, body: j };
}
async function signup(token: string, email: string, password = PW) {
  const r = await signupRoute.POST(req("POST", "/api/auth/signup", {}, { email, password, account: "ignored", invite: token }));
  return { status: r.status, body: (await r.json()) as { error?: string; tenant?: string } };
}
const status = (id: string) => readInvitesFile().find((r) => r.id === id);
const pending = (id: string) => { const r = status(id)!; return !r.usedAt && !r.revokedAt; };
const del = (id: string, auth: { cookie?: string; key?: string } = { cookie: ownerCookie }) =>
  inviteRoute.DELETE(req("DELETE", `/api/team/invites/${id}`, auth), { params: Promise.resolve({ id }) });
const list = async (auth: { cookie?: string; key?: string } = { cookie: ownerCookie }, q = "") => {
  const r = await invitesRoute.GET(req("GET", `/api/team/invites${q}`, auth));
  return { status: r.status, body: (await r.json()) as { invites: { id: string; status: string; email: string | null }[]; error?: string } };
};
const mac = (id: string, exp: string) => crypto.createHmac("sha256", installKey()).update(`invite4:${id}.${exp}`).digest("hex");

test("an invite works once: the second signup on the same link is refused, and the file is 0600", async () => {
  const email = fresh("once");
  const inv = await invite(ownerCookie, { email, role: "editor", workspaces: ["desk-a"] });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.match(inv.id, /^[0-9a-f]{32}$/);
  assert.match(inv.token, /^inv4\.[0-9a-f]{32}\.\d+\.[0-9a-f]{64}$/);
  assert.ok(await peekInvite(inv.token), "a good link previews");
  const first = await signup(inv.token, email);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.tenant, tenant);
  const joined = (await listMembers(tenant)).find((m) => m.email === email)!;
  assert.equal(joined.role, "editor", "the row's role");
  assert.deepEqual(joined.workspaces, ["desk-a"], "the row's scope");
  const again = await signup(inv.token, email);
  assert.equal(again.status, 400);
  assert.match(again.body.error ?? "", /no longer valid \(used, revoked or expired\)/);
  assert.equal(await peekInvite(inv.token), null, "a used link no longer previews");
  assert.equal(status(inv.id)!.usedBy, (await listMembers(tenant)).find((m) => m.email === email)!.id);
  assert.equal(fs.statSync(path.join(process.env.FOLDRUN_DATA!, "invites.json")).mode & 0o777, 0o600);
});

test("a link with no address lets in one person: a second address is refused", async () => {
  const inv = await invite(ownerCookie, { role: "viewer" });
  assert.equal((await signup(inv.token, fresh("anyone"))).status, 200);
  const second = await signup(inv.token, fresh("anyone"));
  assert.equal(second.status, 400);
  assert.match(second.body.error ?? "", /no longer valid/);
});

test("two acceptances of one link at the same moment make exactly one member", async () => {
  const inv = await invite(ownerCookie, { role: "viewer" });
  const before = (await listMembers(tenant)).length;
  const results = await Promise.all([signup(inv.token, fresh("race")), signup(inv.token, fresh("race")), signup(inv.token, fresh("race"))]);
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results));
  assert.equal((await listMembers(tenant)).length, before + 1);
});

test("joined, removed, back with the same link: refused — and a second pending invite to them is revoked on removal (the OWASP repro)", async () => {
  const email = fresh("gone");
  const inv = await invite(ownerCookie, { email, role: "editor" });
  assert.equal((await signup(inv.token, email)).status, 200);
  const member = (await listMembers(tenant)).find((m) => m.email === email)!;
  // A second invite to them while they are a member: it supersedes nothing
  // used, and must die with the removal.
  const spare = await invite(ownerCookie, { email, role: "admin" });
  assert.equal(spare.status, 200);
  const removed = await memberRoute.DELETE(req("DELETE", `/api/team/members/${member.id}`, { cookie: ownerCookie }), { params: Promise.resolve({ id: member.id }) });
  assert.equal(removed.status, 200, await removed.clone().text());
  assert.equal(status(spare.id)!.revokeReason, "its maker or addressee left the team");
  const back = await signup(inv.token, email);
  assert.equal(back.status, 400, "the link they came in on");
  const backSpare = await signup(spare.token, email);
  assert.equal(backSpare.status, 400, "the spare one");
  assert.equal((await listMembers(tenant)).some((m) => m.email === email), false);
});

test("a wrong address, a taken address or a weak password leave the invite pending for the right person", async () => {
  const email = fresh("right");
  const inv = await invite(ownerCookie, { email, role: "viewer" });
  const wrong = await signup(inv.token, fresh("wrong"));
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error ?? "", /this invite was sent to/);
  assert.ok(pending(inv.id), "after a wrong address");
  const anyone = await invite(ownerCookie, { role: "viewer" });
  const taken = await signup(anyone.token, "owner@inv.test");
  assert.equal(taken.status, 400);
  assert.match(taken.body.error ?? "", /already exists/);
  assert.ok(pending(anyone.id), "after a taken address");
  const weak = await signup(inv.token, email, "short");
  assert.equal(weak.status, 400);
  assert.ok(pending(inv.id), "after a weak password");
  assert.equal((await signup(inv.token, email)).status, 200, "the right person still gets in");
});

test("a tampered, unknown, expired or pre-29-Oct link is refused", async () => {
  const inv = await invite(ownerCookie, { role: "viewer" });
  const [, id, exp, sig] = inv.token.split(".");
  const flip = (s: string) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
  const future = String(Date.now() + 864e5);
  const cases = {
    tamperedMac: `inv4.${id}.${exp}.${flip(sig)}`,
    tamperedExpiry: `inv4.${id}.${Number(exp) + 1000}.${sig}`,
    unknownId: (() => { const u = "f".repeat(32); return `inv4.${u}.${future}.${mac(u, future)}`; })(),
    pastExpiry: (() => { const past = String(Date.now() - 1000); return `inv4.${id}.${past}.${mac(id, past)}`; })(),
    inv3: `inv3.${tenant}.admin.*.-.${future}.${"a".repeat(64)}`,
    inv1: `inv1.${tenant}.${future}.${"a".repeat(64)}`,
    garbage: "not-an-invite",
  };
  for (const [name, token] of Object.entries(cases)) {
    const r = await signup(token, fresh("bad"));
    assert.equal(r.status, 400, name);
    assert.match(r.body.error ?? "", /no longer valid/, name);
    assert.equal(await peekInvite(token), null, name);
  }
  // The row's own expiry wins over a link that claims longer.
  const rows = readInvitesFile();
  rows.find((r) => r.id === id)!.expiresAt = new Date(Date.now() - 1000).toISOString();
  writeInvitesFile(rows);
  const longer = `inv4.${id}.${future}.${mac(id, future)}`;
  assert.equal((await signup(longer, fresh("late"))).status, 400, "an expired row");
  assert.ok(pending(id), "still not used — just expired");
});

test("revoked: the link stops; revoking again is 200 revoked:false; revoking a used one is 409; unknown is 404", async () => {
  const inv = await invite(ownerCookie, { email: fresh("rv"), role: "viewer" });
  const r1 = await del(inv.id);
  assert.equal(r1.status, 200, await r1.clone().text());
  assert.equal(((await r1.json()) as { revoked: boolean }).revoked, true);
  assert.equal((await signup(inv.token, status(inv.id)!.email!)).status, 400);
  const r2 = await del(inv.id);
  assert.equal(r2.status, 200);
  assert.equal(((await r2.json()) as { revoked: boolean }).revoked, false);

  const used = await invite(ownerCookie, { role: "viewer" });
  assert.equal((await signup(used.token, fresh("used"))).status, 200);
  assert.equal((await del(used.id)).status, 409);
  assert.equal((await del("0".repeat(32))).status, 404);

  // An expired one: 200, revoked:false, and it stays "expired".
  const old = await invite(ownerCookie, { role: "viewer" });
  const rows = readInvitesFile();
  rows.find((r) => r.id === old.id)!.expiresAt = new Date(Date.now() - 1000).toISOString();
  writeInvitesFile(rows);
  const r3 = await del(old.id);
  assert.equal(r3.status, 200);
  const j3 = (await r3.json()) as { revoked: boolean; invite: { status: string } };
  assert.equal(j3.revoked, false);
  assert.equal(j3.invite.status, "expired");
  assert.equal(status(old.id)!.revokedAt, null);
});

test("pending list: GET shows pending ones, never a link; ?all=1 shows the rest", async () => {
  const inv = await invite(ownerCookie, { email: fresh("ls"), role: "viewer" });
  const { status: s, body } = await list();
  assert.equal(s, 200);
  assert.ok(body.invites.some((i) => i.id === inv.id && i.status === "pending"));
  assert.ok(body.invites.every((i) => i.status === "pending"));
  assert.doesNotMatch(JSON.stringify(body), /inv4\.|signup\?invite/);
  const all = await list(undefined, "?all=1");
  assert.ok(all.body.invites.some((i) => i.status === "accepted"));
  assert.ok(all.body.invites.some((i) => i.status === "revoked"));
});

test("a newer invite to the same address supersedes the older pending one", async () => {
  const email = fresh("again");
  const first = await invite(ownerCookie, { email, role: "viewer" });
  const second = await invite(ownerCookie, { email: email.toUpperCase(), role: "editor" });
  assert.equal(status(first.id)!.revokeReason, "superseded by a newer invite to the same address");
  assert.ok(pending(second.id));
  assert.equal((await signup(first.token, email)).status, 400);
  assert.equal((await signup(second.token, email)).status, 200);
});

test("a newer invite supersedes only what its maker could revoke: a scoped admin leaves the owner's wider invites alone", async () => {
  const scoped = await createUser(fresh("sup"), PW, tenant, { joining: true, role: "admin", workspaces: ["desk-a"] });
  const scopedCookie = await cookieOf(scoped);
  const email = fresh("target");
  const ownersAdmin = await invite(ownerCookie, { email, role: "admin", workspaces: ["desk-a"] });
  const ownersWide = await invite(ownerCookie, { email: email, role: "viewer" });
  // The owner's second one superseded the first (the owner may revoke anything).
  assert.ok(!pending(ownersAdmin.id));
  const again = await invite(ownerCookie, { email, role: "admin", workspaces: ["desk-a"] });
  assert.ok(!pending(ownersWide.id));
  const mine = await invite(scopedCookie, { email, role: "viewer", workspaces: ["desk-a"] });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(pending(again.id), "an admin invite is the owner's to revoke — not superseded by a scoped admin");
  const wider = await invite(ownerCookie, { email: fresh("wide"), role: "viewer" });
  const w = status(wider.id)!.email!;
  await invite(scopedCookie, { email: w, role: "viewer", workspaces: ["desk-a"] });
  assert.ok(pending(wider.id), "an every-workspace invite is outside a scoped admin's reach");
});

test("removal revokes the invites to their address in the same step: none is left to accept after", async () => {
  const email = fresh("atomic");
  const inv = await invite(ownerCookie, { email, role: "viewer" });
  assert.equal((await signup(inv.token, email)).status, 200);
  const member = (await listMembers(tenant)).find((m) => m.email === email)!;
  const spare = await invite(ownerCookie, { email, role: "viewer" });
  const [removed, rejoin] = await Promise.all([
    memberRoute.DELETE(req("DELETE", `/api/team/members/${member.id}`, { cookie: ownerCookie }), { params: Promise.resolve({ id: member.id }) }),
    signup(spare.token, email),
  ]);
  assert.equal(removed.status, 200);
  // Either the rejoin came first and was refused (still a member: taken
  // address), or the removal came first and revoked the spare. Never both in.
  assert.equal(rejoin.status, 400, JSON.stringify(rejoin.body));
  assert.equal((await listMembers(tenant)).some((m) => m.email === email), false);
  assert.ok(!pending(spare.id));
});

test("a minter removed or demoted voids what they handed out", async () => {
  const admin = await createUser(fresh("admin"), PW, tenant, { joining: true, role: "admin" });
  const adminCookie = await cookieOf(admin);
  const a = await invite(adminCookie, { email: fresh("from-admin"), role: "editor" });
  const b = await invite(adminCookie, { role: "viewer", workspaces: ["desk-a"] });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  // Demoted to editor: they can no longer invite anyone.
  const demote = await memberRoute.PATCH(req("PATCH", `/api/team/members/${admin.id}`, { cookie: ownerCookie }, { role: "editor" }), { params: Promise.resolve({ id: admin.id }) });
  assert.equal(demote.status, 200, await demote.clone().text());
  assert.equal(status(a.id)!.revokeReason, "its maker's role or workspaces narrowed");
  assert.equal(status(b.id)!.revokeReason, "its maker's role or workspaces narrowed");
  assert.equal((await signup(b.token, fresh("late"))).status, 400);

  // Removed: same. And an invite whose revocation was missed (written
  // straight into the file) is still refused, because the maker is checked
  // again on accept.
  const admin2 = await createUser(fresh("admin"), PW, tenant, { joining: true, role: "admin", workspaces: ["desk-a", "desk-b"] });
  const c = await invite(await cookieOf(admin2), { role: "viewer", workspaces: ["desk-b"] });
  const d = await invite(await cookieOf(admin2), { role: "viewer", workspaces: ["desk-a"] });
  // Narrowed to desk-a: the desk-b invite goes, the desk-a one stays.
  const narrow = await memberRoute.PATCH(req("PATCH", `/api/team/members/${admin2.id}`, { cookie: ownerCookie }, { workspaces: ["desk-a"] }), { params: Promise.resolve({ id: admin2.id }) });
  assert.equal(narrow.status, 200, await narrow.clone().text());
  assert.ok(!pending(c.id), "desk-b is no longer theirs to give");
  assert.ok(pending(d.id), "desk-a still is");
  const rows = readInvitesFile();
  // Put c back to pending, as if its revocation had never been written.
  Object.assign(rows.find((r) => r.id === c.id)!, { revokedAt: null, revokedBy: null, revokeReason: null });
  writeInvitesFile(rows);
  assert.equal((await signup(c.token, fresh("missed"))).status, 400, "the maker's scope is checked on accept");
  const gone = await memberRoute.DELETE(req("DELETE", `/api/team/members/${admin2.id}`, { cookie: ownerCookie }), { params: Promise.resolve({ id: admin2.id }) });
  assert.equal(gone.status, 200);
  assert.ok(!pending(d.id), "removed: their invites go");
  assert.equal((await signup(d.token, fresh("late"))).status, 400);
});

test("another account's invite is a 404 there, and is not in its list", async () => {
  const other = await createUser("boss@other-inv.test", PW, "other-inv");
  const otherCookie = await cookieOf(other);
  const inv = await invite(ownerCookie, { role: "viewer" });
  assert.equal((await del(inv.id, { cookie: otherCookie })).status, 404);
  assert.ok(pending(inv.id));
  const theirs = await list({ cookie: otherCookie });
  assert.equal(theirs.status, 200);
  assert.ok(!theirs.body.invites.some((i) => i.id === inv.id));
});

test("a scoped admin sees and revokes only invites inside its scope; an admin invite is the owner's to revoke", async () => {
  const scoped = await createUser(fresh("scoped"), PW, tenant, { joining: true, role: "admin", workspaces: ["desk-a"] });
  const scopedCookie = await cookieOf(scoped);
  const inA = await invite(ownerCookie, { role: "viewer", workspaces: ["desk-a"] });
  const inB = await invite(ownerCookie, { role: "viewer", workspaces: ["desk-b"] });
  const everywhere = await invite(ownerCookie, { role: "viewer" });
  const adminInv = await invite(ownerCookie, { role: "admin", workspaces: ["desk-a"] });
  const seen = (await list({ cookie: scopedCookie })).body.invites.map((i) => i.id);
  assert.ok(seen.includes(inA.id));
  assert.ok(!seen.includes(inB.id));
  assert.ok(!seen.includes(everywhere.id));
  assert.equal((await del(inB.id, { cookie: scopedCookie })).status, 403);
  assert.equal((await del(everywhere.id, { cookie: scopedCookie })).status, 403);
  assert.equal((await del(adminInv.id, { cookie: scopedCookie })).status, 403);
  assert.equal((await del(inA.id, { cookie: scopedCookie })).status, 200);
  assert.ok(pending(inB.id) && pending(everywhere.id) && pending(adminInv.id));
});

test("keys: an admin key may list and revoke, an editor key may not, and no key may invite", async () => {
  const adminKey = (await createApiKey(tenant, "ci admin", owner.email, undefined, "admin", null)).key;
  const editorKey = (await createApiKey(tenant, "ci editor", owner.email, undefined, "editor", null)).key;
  assert.equal((await list({ key: adminKey })).status, 200);
  assert.equal((await list({ key: editorKey })).status, 403);
  const inv = await invite(ownerCookie, { role: "viewer" });
  assert.equal((await del(inv.id, { key: editorKey })).status, 403);
  assert.equal((await del(inv.id, { key: adminKey })).status, 200);
  const minted = await teamRoute.POST(req("POST", "/api/team", { key: adminKey }, { role: "viewer" }));
  assert.equal(minted.status, 401, "inviting is a person's");
});
