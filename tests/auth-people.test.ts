// Sign-in, email change and the second factor (30 Oct 2026 review):
//  - asking to move a login answers the same whether or not the address is
//    taken; the move happens at the link mailed to the new address;
//  - the password counter is not cleared before the whole request went
//    through, and a person may ask five times a day (each asks mails an
//    address they typed, from the platform's sender);
//  - ten wrong six-digit codes in a row pause app codes and mail the owner,
//    a backup code still signs in; every 429 says when to come back;
//  - a closed install refuses a sign-up before the password work;
//  - a field that should be text and is not is a 400, not a 500.
//
//   node --import ./tests/register.mjs --test tests/auth-people.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-auth-people-"));
process.env.FOLDRUN_SECRET_KEY = "auth-people-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
process.env.FOLDRUN_RESEND_API_KEY = "re_test_auth_people";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;
delete process.env.FOLDRUN_PUBLIC_URL;

// Every mail the platform sends, captured instead of sent.
const mails: { to: string; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === "https://api.resend.com/emails") {
    const b = JSON.parse(String(init?.body));
    mails.push({ to: Array.isArray(b.to) ? b.to.join(",") : b.to, subject: b.subject, text: b.text });
    return new Response(JSON.stringify({ id: "m" }), { status: 200 });
  }
  return realFetch(url, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { createUser, mintSession, findUserById, changePassword, setMfa, SESSION_COOKIE } = await import("../server/users.ts");
const { mintToken, CHALLENGE_TTL_MS } = await import("../server/auth-tokens.ts");
const { totp, hashBackup } = await import("../server/totp.ts");
const { rateLimitReset } = await import("@/platform/cache");
const emailRoute = await import("../app/api/auth/email/route.ts");
const verifyRoute = await import("../app/api/auth/verify/route.ts");
const mfaVerify = await import("../app/api/auth/mfa/verify/route.ts");
const login = await import("../app/api/auth/login/route.ts");
const signup = await import("../app/api/auth/signup/route.ts");
const nameRoute = await import("../app/api/auth/name/route.ts");
const { refuseNonText } = await import("../server/auth-input.ts");

const PW = "a long enough password 1";
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const cookieFor = async (id: string) => `${SESSION_COOKIE}=${(await mintSession((await findUserById(id))!)).value}`;
const askMove = (cookie: string, email: unknown, password: unknown = PW) =>
  emailRoute.POST(new NextRequest("http://x/api/auth/email", json({ email, password }, { cookie })));
const mailTo = (to: string) => mails.filter((m) => m.to === to);
const linkIn = (text: string) => text.match(/http:\/\/x\/api\/auth\/verify\?token=\S+/)?.[0] ?? null;
const click = (url: string) => verifyRoute.GET(new NextRequest(url));

test("asking to move: the same answer for a taken and a free address, and nothing moves yet", async () => {
  await createUser("taken@people.test", PW, "people-taken");
  const me = await createUser("mover@people.test", PW, "people-mover");
  const cookie = await cookieFor(me.id);

  const free = await askMove(cookie, "Fresh@People.test");
  const taken = await askMove(cookie, "taken@people.test");
  assert.equal(free.status, 200);
  assert.equal(taken.status, 200, "a 409 here told anyone which addresses had a login");
  const a = await free.json(), b = await taken.json();
  assert.deepEqual({ ...a, to: "" }, { ...b, to: "" });
  assert.equal(a.pending, true);
  assert.equal(a.to, "fresh@people.test");
  assert.equal((await findUserById(me.id))!.email, "mover@people.test", "the login has not moved");

  // Each address got one mail; only the free one carries a link.
  assert.ok(linkIn(mailTo("fresh@people.test")[0].text), "the free address gets the link");
  assert.equal(mailTo("taken@people.test").length, 1);
  assert.equal(linkIn(mailTo("taken@people.test")[0].text), null, "the taken one is told, with no link");
  assert.equal(mailTo("mover@people.test").length, 0, "the old address hears only when it moves");
});

test("the link moves the login, verifies it, tells the old address, and works once", async () => {
  const me = await createUser("clicker@people.test", PW, "people-clicker");
  const cookie = await cookieFor(me.id);
  assert.equal((await askMove(cookie, "clicked@people.test")).status, 200);
  const url = linkIn(mailTo("clicked@people.test").at(-1)!.text)!;

  const r = await click(url);
  assert.match(r.headers.get("location") ?? "", /\/dashboard\?verified=1$/);
  const after = (await findUserById(me.id))!;
  assert.equal(after.email, "clicked@people.test");
  assert.ok(after.emailVerifiedAt, "clicking from the new inbox proves it");
  for (let i = 0; i < 100 && !mailTo("clicker@people.test").length; i++) await new Promise((res) => setTimeout(res, 10));
  assert.match(mailTo("clicker@people.test")[0]?.subject ?? "", /login address was changed/);

  assert.match((await click(url)).headers.get("location") ?? "", /verify=invalid/, "used once");
});

test("a used link stays dead after the login moves back (A → B → A)", async () => {
  // Codex, 30 Oct 2026: "still at the old address" was the single-use mark,
  // so moving back made the first link good again for whoever kept it.
  const me = await createUser("roundtrip@people.test", PW, "people-roundtrip");
  assert.equal((await askMove(await cookieFor(me.id), "roundtrip-b@people.test")).status, 200);
  const there = linkIn(mailTo("roundtrip-b@people.test").at(-1)!.text)!;
  assert.match((await click(there)).headers.get("location") ?? "", /verified=1/);
  assert.equal((await askMove(await cookieFor(me.id), "roundtrip@people.test")).status, 200);
  const back = linkIn(mailTo("roundtrip@people.test").filter((m) => linkIn(m.text)).at(-1)!.text)!;
  assert.match((await click(back)).headers.get("location") ?? "", /verified=1/);
  assert.equal((await findUserById(me.id))!.email, "roundtrip@people.test");

  assert.match((await click(there)).headers.get("location") ?? "", /verify=invalid/, "the first link is spent");
  assert.equal((await findUserById(me.id))!.email, "roundtrip@people.test", "and did not move it again");
});

test("two links asked for at once: the first click spends the other", async () => {
  const me = await createUser("twolinks@people.test", PW, "people-twolinks");
  const cookie = await cookieFor(me.id);
  await askMove(cookie, "twolinks-1@people.test");
  await askMove(cookie, "twolinks-2@people.test");
  const one = linkIn(mailTo("twolinks-1@people.test").at(-1)!.text)!;
  const two = linkIn(mailTo("twolinks-2@people.test").at(-1)!.text)!;
  assert.match((await click(one)).headers.get("location") ?? "", /verified=1/);
  assert.match((await click(two)).headers.get("location") ?? "", /verify=invalid/);
  assert.equal((await findUserById(me.id))!.email, "twolinks-1@people.test");
});

test("a password change since the request cancels the move", async () => {
  const me = await createUser("cancel@people.test", PW, "people-cancel");
  assert.equal((await askMove(await cookieFor(me.id), "cancelled@people.test")).status, 200);
  const url = linkIn(mailTo("cancelled@people.test").at(-1)!.text)!;
  await changePassword(me.id, PW, "another long password 2");
  assert.match((await click(url)).headers.get("location") ?? "", /verify=invalid/);
  assert.equal((await findUserById(me.id))!.email, "cancel@people.test");
});

test("the password counter is not cleared before the request went through", async () => {
  const me = await createUser("counter@people.test", PW, "people-counter");
  const cookie = await cookieFor(me.id);
  for (let i = 0; i < 5; i++) assert.equal((await askMove(cookie, "x@people.test", "wrong password!!")).status, 400);
  // Right password, but no address: the request did not go through.
  assert.equal((await askMove(cookie, "not an address")).status, 400);
  const r = await askMove(cookie, "y@people.test");
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) > 0);
});

test("five moves asked for a day, then a 429 that says when", async () => {
  const me = await createUser("daily@people.test", PW, "people-daily");
  const cookie = await cookieFor(me.id);
  for (let i = 1; i <= 5; i++) assert.equal((await askMove(cookie, `daily${i}@people.test`)).status, 200, `request ${i}`);
  const sixth = await askMove(cookie, "daily6@people.test");
  assert.equal(sixth.status, 429);
  assert.ok(Number(sixth.headers.get("retry-after")) > 60 * 60, "the day's window, not the quarter hour's");
  assert.equal(mailTo("daily6@people.test").length, 0, "no mail past the cap");
});

test("an install that sends no mail still moves at once", async () => {
  const me = await createUser("nomail@people.test", PW, "people-nomail");
  const cookie = await cookieFor(me.id);
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    const r = await askMove(cookie, "nomail-new@people.test");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).pending, false);
    assert.equal((await findUserById(me.id))!.email, "nomail-new@people.test");
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = "re_test_auth_people";
  }
});

// ------------------------------------------------------------------ MFA

const SECRET = "JBSWY3DPEHPK3PXP";
const verifyCode = (userId: string, code: string) =>
  mfaVerify.POST(new NextRequest("http://x/api/auth/mfa/verify", json({ challenge: mintToken("mfa-challenge", { u: userId }, CHALLENGE_TTL_MS), code })));
/** A six-digit code the app would not show now or either side of now. */
const wrongCode = (i: number) => {
  const near = new Set([-1, 0, 1].map((w) => totp(SECRET, Date.now() + w * 30_000)));
  for (let n = i; ; n++) {
    const c = String(100000 + ((n * 7919) % 900000));
    if (!near.has(c)) return c;
  }
};

test("ten wrong app codes in a row pause app codes, mail the owner, and a backup code still signs in", async () => {
  const me = await createUser("mfa-lock@people.test", PW, "people-mfa-lock");
  await setMfa(me.id, { secret: SECRET, backupHashes: [hashBackup("abcde-fghjk")] });
  for (let i = 0; i < 10; i++) {
    await rateLimitReset(`mfa:${me.id}`); // past the five-minute throttle, which is tested below
    assert.equal((await verifyCode(me.id, wrongCode(i))).status, 401, `wrong code ${i + 1}`);
  }
  await rateLimitReset(`mfa:${me.id}`);
  const paused = await verifyCode(me.id, totp(SECRET));
  assert.equal(paused.status, 429, "even the right app code waits");
  assert.ok(Number(paused.headers.get("retry-after")) > 60 * 60);

  for (let i = 0; i < 100 && !mailTo("mfa-lock@people.test").length; i++) await new Promise((res) => setTimeout(res, 10));
  assert.equal(mailTo("mfa-lock@people.test").length, 1, "the owner is told, once");

  const backup = await verifyCode(me.id, "ABCDE FGHJK");
  assert.equal(backup.status, 200, "a backup code is the way back in");
  assert.equal((await backup.json()).backupUsed, true);
  // And the sign-in that worked starts the count over.
  assert.equal((await verifyCode(me.id, totp(SECRET))).status, 200);
});

test("the five-minute throttle's 429 says when to come back", async () => {
  const me = await createUser("mfa-throttle@people.test", PW, "people-mfa-throttle");
  await setMfa(me.id, { secret: SECRET, backupHashes: [] });
  for (let i = 0; i < 6; i++) await verifyCode(me.id, wrongCode(100 + i));
  const r = await verifyCode(me.id, wrongCode(200));
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) > 0);
});

// --------------------------------------------------------- sign-up, input

test("a closed install refuses a sign-up before it looks at the password", async () => {
  process.env.FOLDRUN_OPEN_SIGNUP = "0";
  try {
    // "short" would fail the password policy first if that still ran first.
    const r = await signup.POST(new NextRequest("http://x/api/auth/signup", json({ email: "stranger@people.test", password: "short", account: "stranger" })));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "signups are closed on this install");
  } finally {
    process.env.FOLDRUN_OPEN_SIGNUP = "1";
  }
});

test("a field that should be text and is not is a 400, not a 500", async () => {
  const l = await login.POST(new NextRequest("http://x/api/auth/login", json({ email: 1, password: "x" })));
  assert.equal(l.status, 400);
  assert.equal((await l.json()).error, "email must be text");
  const s = await signup.POST(new NextRequest("http://x/api/auth/signup", json({ email: ["a@b.c"], password: PW })));
  assert.equal(s.status, 400);
  const me = await createUser("typed@people.test", PW, "people-typed");
  const n = await nameRoute.POST(new NextRequest("http://x/api/auth/name", json({ firstName: 5 }, { cookie: await cookieFor(me.id) })));
  assert.equal(n.status, 400);
  assert.equal((await askMove(await cookieFor(me.id), { a: 1 })).status, 400);
  // The guard itself: absent and null are left to the route.
  assert.equal(refuseNonText({ id: null }, "id"), null);
  assert.equal(refuseNonText({}, "id"), null);
  assert.equal(refuseNonText({ id: 5 }, "id")?.status, 400);
});
