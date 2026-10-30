// A stranger cannot lock a known person out of password sign-in (30 Oct
// 2026). The per-account count was keyed on the typed address alone, so
// eight wrong passwords as someone every quarter hour kept them out for good.
// Now, when a trusted proxy names the caller:
//  - the count is per account AND caller: the stranger locks out only
//    themselves, and the person still signs in from their own address;
//  - a ceiling over every caller (five times as high) still stops a guesser
//    spread over many addresses, and reaching it mails the person once;
//  - with no caller address nobody can be told apart: per account, as before.
//
//   node --import ./tests/register.mjs --test tests/login-lockout.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-login-lockout-"));
process.env.FOLDRUN_SECRET_KEY = "login-lockout-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_RESEND_API_KEY = "re_test_login_lockout";
// Several people sign up here; an install closed to signups refuses all but the first.
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;
delete process.env.FOLDRUN_PUBLIC_URL;

// Every mail the platform sends, captured instead of sent.
const mails: { to: string; subject: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === "https://api.resend.com/emails") {
    const b = JSON.parse(String(init?.body));
    mails.push({ to: Array.isArray(b.to) ? b.to.join(",") : b.to, subject: b.subject });
    return new Response(JSON.stringify({ id: "m" }), { status: 200 });
  }
  return realFetch(url, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { createUser } = await import("../server/users.ts");
const { recentAudit } = await import("../server/audit.ts");
const login = await import("../app/api/auth/login/route.ts");

const PW = "a long enough password 1";
const signIn = (email: string, password: string, ip?: string) =>
  login.POST(new NextRequest("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: JSON.stringify({ email, password }),
  }));

test("a stranger failing as someone locks out only themselves; the person still signs in from their own address", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    await createUser("ceo@lockout.test", PW, "lockout-ceo");
    for (let i = 0; i < 8; i++) assert.equal((await signIn("ceo@lockout.test", "wrong", "203.0.113.50")).status, 401, `try ${i + 1}`);
    assert.equal((await signIn("ceo@lockout.test", PW, "203.0.113.50")).status, 429, "the stranger's own address is locked out, even with the right password");
    const real = await signIn("ceo@lockout.test", PW, "198.51.100.20");
    assert.equal(real.status, 200, "the person, from their own address, is not");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("a guesser spread over many addresses meets the ceiling over every caller, and the person is mailed once", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    await createUser("spread@lockout.test", PW, "lockout-spread");
    // Five addresses × eight wrong passwords: the fortieth is the last try.
    for (let a = 1; a <= 5; a++) {
      for (let i = 0; i < 8; i++) assert.equal((await signIn("spread@lockout.test", "wrong", `192.0.2.${a}`)).status, 401, `address ${a}, try ${i + 1}`);
    }
    assert.equal((await signIn("spread@lockout.test", PW, "192.0.2.99")).status, 429, "past the ceiling, a sixth address is refused too");
    // The notice is sent after the answer; wait for it.
    for (let i = 0; i < 200 && !mails.some((m) => m.to === "spread@lockout.test"); i++) await new Promise((r) => setTimeout(r, 10));
    const notices = mails.filter((m) => m.to === "spread@lockout.test");
    assert.equal(notices.length, 1, "told once");
    assert.match(notices[0].subject, /wrong password/);
    assert.ok((await recentAudit("lockout-spread")).some((e) => e.action === "login.throttled"));
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("an unknown address that reaches the ceiling mails nobody", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const before = mails.length;
    for (let a = 1; a <= 5; a++) {
      for (let i = 0; i < 8; i++) await signIn("nobody@lockout.test", "wrong", `192.0.2.${100 + a}`);
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(mails.length, before);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("with no caller address nobody can be told apart: eight wrong tries close the account's password sign-in, as before", async () => {
  await createUser("noproxy@lockout.test", PW, "lockout-noproxy");
  for (let i = 0; i < 8; i++) assert.equal((await signIn("noproxy@lockout.test", "wrong")).status, 401);
  assert.equal((await signIn("noproxy@lockout.test", PW)).status, 429);
});
