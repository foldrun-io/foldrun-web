// Invites, the rest of the behaviour (FOL-464 steps 4 and 5): the invited
// person sees an invite without the mail and may decline it; the inviter
// may send it again and copy its link; a day has limits; the one who made
// an invite is told how it ended; and only the MAILED link proves the
// address. File mode; the store's Postgres half is covered by
// one-login-several-accounts-db and team-invites-db.
//
//   node --import ./tests/register.mjs --test tests/invite-answers.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-invite-answers-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
process.env.FOLDRUN_RESEND_API_KEY = "re_test";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

// Every mail the platform sends goes to Resend: kept here, never sent.
const mails: { to: string; subject: string; text: string }[] = [];
let mailDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.resend.com/")) return realFetch(input, init);
  if (mailDown) return new Response("{}", { status: 500 });
  const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string | string[]; subject?: string; text?: string };
  mails.push({ to: String(Array.isArray(body.to) ? body.to[0] : body.to), subject: body.subject ?? "", text: body.text ?? "" });
  return new Response(JSON.stringify({ id: "mail" }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { createUser, mintSession, SESSION_COOKIE, setEmailVerified, findUser, findMember, peekInvite, accountsOf, invitesFor, mintInvite, joinById, declineInvite } = await import("../server/users.ts");
const { saveWorkspace, templateFiles } = await import("@/lib/store.ts");
const { readInvitesFile, writeInvitesFile } = await import("@/platform/invites.ts");
const { noticeExpiredInvites } = await import("../server/invite-notices.ts");
const teamRoute = await import("../app/v1/team/route.ts");
const invitesRoute = await import("../app/v1/team/invites/route.ts");
const resendRoute = await import("../app/v1/team/invites/[id]/resend/route.ts");
const linkRoute = await import("../app/v1/team/invites/[id]/link/route.ts");
const mineRoute = await import("../app/v1/me/invites/route.ts");
const answerRoute = await import("../app/v1/me/invites/[id]/route.ts");
const signupRoute = await import("../app/v1/auth/signup/route.ts");

const PW = "a long and unusual passphrase 42!";
const BASE = "http://localhost:3900";
const person = async (email: string, account: string) => {
  const u = await createUser(email, PW, account, { request: "free" });
  await setEmailVerified(u.id);
  saveWorkspace(account, "home", templateFiles("home"));
  return { ...u, cookie: `${SESSION_COOKIE}=${(await mintSession(u)).value}` };
};
const boss = await person("boss@ans.test", "ans-co");
const ana = await person("ana@ans.test", "ana-home");

const req = (method: string, p: string, cookie?: string, body?: unknown) =>
  new NextRequest(`${BASE}${p}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), origin: BASE, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => (await r.json()) as Record<string, any>;
async function invite(email: string, extra: Record<string, unknown> = {}) {
  const r = await teamRoute.POST(req("POST", "/v1/team", boss.cookie, { email, role: "editor", ...extra }));
  const j = await json(r);
  return { status: r.status, id: j.id as string, copy: typeof j.path === "string" ? decodeURIComponent(j.path.split("invite=")[1]) : "", body: j };
}
/** The link in the last invite mail to this address. */
const mailedLink = (to: string) => {
  const m = [...mails].reverse().find((x) => x.to === to && /signup\?invite=/.test(x.text));
  return m ? decodeURIComponent(/signup\?invite=(\S+)/.exec(m.text)![1]) : "";
};
const row = (id: string) => readInvitesFile().find((r) => r.id === id)!;
const signup = async (token: string, email: string) => {
  const r = await signupRoute.POST(req("POST", "/v1/auth/signup", undefined, { email, password: PW, account: "ignored", invite: token }));
  return { status: r.status, body: await json(r) };
};

test("the mail and the inviter hold different links to one invite, and neither is stored", async () => {
  const inv = await invite("new1@ans.test");
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  const mailed = mailedLink("new1@ans.test");
  assert.match(inv.copy, /^inv4\./);
  assert.match(mailed, /^inv5\./);
  assert.notEqual(inv.copy.split(".")[3], mailed.split(".")[3], "each its own secret");
  assert.equal((await peekInvite(inv.copy))?.mailed, false);
  assert.equal((await peekInvite(mailed))?.mailed, true);
  // One kind's secret does not pass as the other's.
  assert.equal(await peekInvite(inv.copy.replace(/^inv4/, "inv5")), null);
  assert.equal(await peekInvite(mailed.replace(/^inv5/, "inv4")), null);
  assert.doesNotMatch(fs.readFileSync(path.join(process.env.FOLDRUN_DATA!, "invites.json"), "utf8"), new RegExp(mailed.split(".")[3]));
});

test("the mailed link confirms the address at sign-up and no confirmation mail follows; the copy link does not", async () => {
  const a = await invite("mailed@ans.test");
  const before = mails.length;
  const viaMail = await signup(mailedLink("mailed@ans.test"), "mailed@ans.test");
  assert.equal(viaMail.status, 200, JSON.stringify(viaMail.body));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok((await findUser("mailed@ans.test"))?.emailVerifiedAt, "confirmed by the link");
  assert.equal(mails.slice(before).some((m) => m.to === "mailed@ans.test"), false, "no second mail to the new person");
  assert.ok(mails.slice(before).some((m) => m.to === "boss@ans.test" && /accepted/.test(m.subject)), "the inviter is told");
  assert.equal(row(a.id).usedBy !== null, true);

  const b = await invite("copied@ans.test");
  const from = mails.length;
  const viaCopy = await signup(b.copy, "copied@ans.test");
  assert.equal(viaCopy.status, 200, JSON.stringify(viaCopy.body));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await findUser("copied@ans.test"))?.emailVerifiedAt ?? null, null, "the copy link proves nothing");
  assert.ok(mails.slice(from).some((m) => m.to === "copied@ans.test"), "confirmed the usual way: a mail");
  // Either link is spent with the invite: the mailed one no longer works.
  assert.equal(await peekInvite(mailedLink("copied@ans.test")), null);
});

test("an address already in the account is refused, and nothing is made", async () => {
  const before = readInvitesFile().length;
  const again = await invite("mailed@ans.test");
  assert.equal(again.status, 409);
  assert.match(String(again.body.error), /already a member of this account/);
  assert.equal(readInvitesFile().length, before);
  // An address with a login elsewhere answers like one with none.
  const elsewhere = await invite("ana@ans.test", { send: false });
  const nobody = await invite("nobody@ans.test", { send: false });
  assert.deepEqual(Object.keys(elsewhere.body).sort(), Object.keys(nobody.body).sort());
  assert.equal(elsewhere.status, nobody.status);
});

test("a signed-in person sees the invite without the mail, and only their own", async () => {
  const inv = row((await invite("ana@ans.test", { send: false })).id);
  const mine = await json(await mineRoute.GET(req("GET", "/v1/me/invites", ana.cookie)));
  assert.deepEqual(mine.invites.map((i: any) => [i.id, i.account, i.role, i.invitedBy]), [[inv.id, "ans-co", "editor", "boss@ans.test"]]);
  assert.match(mine.invites[0].path, /^\/signup\?invite=inv4/);
  assert.deepEqual((await json(await mineRoute.GET(req("GET", "/v1/me/invites", boss.cookie)))).invites, []);
  assert.equal((await mineRoute.GET(req("GET", "/v1/me/invites"))).status, 401);
  // Not for an address that is not confirmed: who holds that inbox is not known yet.
  const loose = await createUser("loose@ans.test", PW, "loose-home", { request: "free" });
  await invite("loose@ans.test", { send: false });
  assert.deepEqual(await invitesFor(loose.id), []);
});

test("decline: only the invited person, once; the invite is over for both links and the inviter is told", async () => {
  const id = (await invitesFor(ana.id))[0].id;
  // Someone else's id reads as a dead link, and changes nothing.
  const other = await answerRoute.POST(req("POST", `/v1/me/invites/${id}`, boss.cookie, { action: "decline" }), withId(id));
  assert.equal(other.status, 400);
  assert.match(String((await json(other)).error), /no longer valid/);
  assert.equal(row(id).revokedAt, null);
  assert.equal((await answerRoute.POST(req("POST", `/v1/me/invites/${id}`, ana.cookie, { action: "shrug" }), withId(id))).status, 400);

  const from = mails.length;
  const done = await answerRoute.POST(req("POST", `/v1/me/invites/${id}`, ana.cookie, { action: "decline" }), withId(id));
  assert.equal(done.status, 200);
  assert.deepEqual(await json(done), { ok: true, declined: true, account: "ans-co" });
  assert.equal(row(id).revokeReason, "declined");
  assert.ok(mails.slice(from).some((m) => m.to === "boss@ans.test" && /declined/.test(m.subject)));
  assert.deepEqual(await invitesFor(ana.id), []);
  assert.equal((await answerRoute.POST(req("POST", `/v1/me/invites/${id}`, ana.cookie, { action: "decline" }), withId(id))).status, 400, "once");
  assert.equal((await answerRoute.POST(req("POST", `/v1/me/invites/${id}`, ana.cookie, { action: "join" }), withId(id))).status, 400, "a declined invite joins nobody");
  const all = await json(await invitesRoute.GET(req("GET", "/v1/team/invites?all=1", boss.cookie)));
  assert.equal(all.invites.find((i: any) => i.id === id).status, "declined");
});

test("join by id: the invited person becomes a member, their own account kept, and the inviter is told", async () => {
  const inv = await invite("ana@ans.test", { send: false, role: "viewer" });
  const from = mails.length;
  const r = await answerRoute.POST(req("POST", `/v1/me/invites/${inv.id}`, ana.cookie, { action: "join" }), withId(inv.id));
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await json(r), { ok: true, joined: true, account: "ans-co", role: "viewer", workspaces: null });
  assert.deepEqual((await accountsOf(ana.id)).map((a) => [a.tenant, a.role]), [["ana-home", "owner"], ["ans-co", "viewer"]]);
  assert.ok(mails.slice(from).some((m) => m.to === "boss@ans.test" && /accepted/.test(m.subject)));
  assert.ok(await findMember("ans-co", { id: ana.id }));
});

test("send again and copy link: for a pending invite, by someone who could make it; a resend waits ten minutes", async () => {
  const inv = await invite("later@ans.test");
  const first = mailedLink("later@ans.test");
  const from = mails.length;
  const again = await resendRoute.POST(req("POST", `/v1/team/invites/${inv.id}/resend`, boss.cookie), withId(inv.id));
  assert.equal(again.status, 200, await again.clone().text());
  assert.equal((await json(again)).sent, true);
  assert.equal(mails.length, from + 1);
  assert.equal(mailedLink("later@ans.test"), first, "the same mailed link");
  const tooSoon = await resendRoute.POST(req("POST", `/v1/team/invites/${inv.id}/resend`, boss.cookie), withId(inv.id));
  assert.equal(tooSoon.status, 429);
  assert.ok(Number(tooSoon.headers.get("retry-after")) > 0);

  const link = await linkRoute.POST(req("POST", `/v1/team/invites/${inv.id}/link`, boss.cookie), withId(inv.id));
  assert.equal(link.status, 200);
  const got = await json(link);
  assert.equal(decodeURIComponent(String(got.path).split("invite=")[1]), inv.copy, "the copy link, never the mailed one");
  assert.equal(link.headers.get("cache-control"), "no-store");

  // Not for a member who is no admin, not signed out, and not for another account's invite.
  assert.equal((await linkRoute.POST(req("POST", `/v1/team/invites/${inv.id}/link`, ana.cookie), withId(inv.id))).status, 404, "ana's session is in her own account: not its invite");
  assert.equal((await linkRoute.POST(req("POST", `/v1/team/invites/${inv.id}/link`), withId(inv.id))).status, 401);
  assert.equal((await resendRoute.POST(req("POST", `/v1/team/invites/${"0".repeat(32)}/resend`, boss.cookie), withId("0".repeat(32)))).status, 404);
});

test("one address is mailed at most three invites a day, whoever asks", async () => {
  const to = "flooded@ans.test";
  assert.equal((await invite(to)).status, 200);
  assert.equal((await invite(to)).status, 200);
  assert.equal((await invite(to)).status, 200);
  const fourth = await invite(to);
  assert.equal(fourth.status, 429);
  assert.ok(Number((await teamRoute.POST(req("POST", "/v1/team", boss.cookie, { email: to, role: "editor" }))).headers.get("retry-after")) > 0);
  // A link made without mailing is not a mail to them.
  assert.equal((await invite(to, { send: false })).status, 200);
});

test("an invite that ran out unused: its maker is told once", async () => {
  const inv = await invite("slow@ans.test", { send: false });
  const rows = readInvitesFile();
  rows.find((r) => r.id === inv.id)!.expiresAt = new Date(Date.now() - 60_000).toISOString();
  writeInvitesFile(rows);
  const from = mails.length;
  // The mail cannot go: nothing is told, and the invite is handed back for the next beat.
  mailDown = true;
  assert.equal(await noticeExpiredInvites(), 0);
  mailDown = false;
  assert.equal(row(inv.id).noticedAt ?? null, null, "not marked told when the mail failed");
  assert.equal(await noticeExpiredInvites(), 1);
  assert.ok(mails.slice(from).some((m) => m.to === "boss@ans.test" && /expired/.test(m.subject) && /slow@ans\.test/.test(m.text)));
  assert.equal(await noticeExpiredInvites(), 0, "once");
  assert.ok(row(inv.id).noticedAt);
});

test("a write from a page that showed another account answers 412 with code account_moved, on any route", async () => {
  const id = "0".repeat(32);
  const stale = new NextRequest(`${BASE}/v1/me/invites/${id}`, {
    method: "POST",
    headers: { cookie: ana.cookie, origin: BASE, "content-type": "application/json", "x-foldrun-account": "ans-co" },
    body: JSON.stringify({ action: "decline" }),
  });
  const r = await answerRoute.POST(stale, withId(id));
  assert.equal(r.status, 412);
  assert.equal((await json(r)).code, "account_moved");
});

test("the link that confirms an address is mailed only by the install's own sender", async () => {
  const by = { id: boss.id, email: boss.email };
  const own = await mintInvite("ans-co", "viewer", { email: "own-sender@ans.test", by });
  assert.match(own.mailToken, /^inv5\./);
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    // Through an account's provider its admins can read the mail: it carries the copy link.
    const theirs = await mintInvite("ans-co", "viewer", { email: "their-sender@ans.test", by });
    assert.match(theirs.mailToken, /^inv4\./);
    assert.equal(theirs.mailToken, theirs.token);
    // And a mailed link from before the sender was taken away confirms nothing.
    const { acceptInvite } = await import("../server/users.ts");
    assert.equal((await acceptInvite(own.mailToken, "own-sender@ans.test", PW)).mailed, false);
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = "re_test";
  }
});

test("an address is one mailbox: a list, a display name or a bracket is refused before anything is counted", async () => {
  for (const bad of ["a@ans.test,b@ans.test", "a@ans.test, flooded@ans.test", "Name <a@ans.test>", "a@ans.test;b@ans.test"]) {
    const r = await invite(bad);
    assert.equal(r.status, 400, bad);
  }
});

test("join by id with another person's invite: the dead-link sentence, never the address it was sent to", async () => {
  const inv = await invite("private-person@ans.test", { send: false });
  const r = await answerRoute.POST(req("POST", `/v1/me/invites/${inv.id}`, ana.cookie, { action: "join" }), withId(inv.id));
  assert.equal(r.status, 400);
  const said = String((await json(r)).error);
  assert.match(said, /no longer valid/);
  assert.doesNotMatch(said, /private-person/);
});

test("an answer that was on its way when the person left the account it came from is refused under the lock", async () => {
  const zed = await person("zed@ans.test", "zed-home");
  const inv = await invite("zed@ans.test", { send: false });
  // The request was authorized as a member of "ans-co"; by the time it writes, zed is not one.
  await assert.rejects(() => joinById(inv.id, zed.id, { tenant: "ans-co" }), /no longer stands/);
  await assert.rejects(() => declineInvite(inv.id, zed.id, { tenant: "ans-co" }), /no longer stands/);
  assert.equal(row(inv.id).usedAt, null);
  assert.equal(row(inv.id).revokedAt, null);
  // From the account they are in, with a session that has since ended: refused too.
  await assert.rejects(() => joinById(inv.id, zed.id, { tenant: "zed-home", credential: { session: "gone", user: zed.id } }), /no longer stands/);
  assert.equal((await joinById(inv.id, zed.id, { tenant: "zed-home" })).user.tenant, "ans-co");
});

test("send again and copy link are decided with who the member is now", async () => {
  const { reachInvite } = await import("../server/users.ts");
  const inv = await invite("now@ans.test", { send: false });
  // As someone not (or no longer) in the account: refused, whatever the request came in with.
  const outsider = await person("outsider@ans.test", "outsider-home");
  await assert.rejects(() => reachInvite("ans-co", inv.id, { id: outsider.id, role: "owner", workspaces: null }), /no longer stands/);
  // As a member whose role is lower now than when the request came in.
  await assert.rejects(() => reachInvite("ans-co", inv.id, { id: ana.id, role: "owner", workspaces: null }), /role changed/);
  // As a member whose session has ended since.
  await assert.rejects(() => reachInvite("ans-co", inv.id, { id: boss.id, role: "owner", workspaces: null, credential: { session: "gone", user: boss.id } }), /no longer stands/);
  // A request that came in with fewer projects than the member holds keeps to them.
  await assert.rejects(() => reachInvite("ans-co", inv.id, { id: boss.id, role: "owner", workspaces: ["home"] }), /workspaces you were not given/);
  assert.equal((await reachInvite("ans-co", inv.id, { id: boss.id, role: "owner", workspaces: null })).id, inv.id);
});

test("a refused invite charges no other limit: an account at its cap uses up no address's day", async () => {
  const { rateLimit } = await import("@/platform/cache.ts");
  for (let i = 0; i < 100; i++) await rateLimit("invite:account:cap-co", 100, 86_400);
  const capper = await person("capper@ans.test", "cap-co");
  for (let i = 0; i < 4; i++) {
    const r = await teamRoute.POST(req("POST", "/v1/team", capper.cookie, { email: "spared@ans.test", role: "viewer" }));
    assert.equal(r.status, 429);
  }
  // Another account can still mail that address three times.
  for (let i = 0; i < 3; i++) assert.equal((await invite("spared@ans.test")).status, 200, `mail ${i + 1}`);
});
