// Signing in with an emailed code (FOL-185): the codes and the counts live in
// Postgres, so this runs against it.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/login-code-db.test.ts
//
// What it holds: the same answer for every address, a code that works once and
// only from the browser that asked, three wrong guesses and the lock, expiry,
// the 30 s throttle, the per-address mail cap, a second factor still asked,
// and the method on the audit line and the session.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-login-code-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_CODE_FAIL_FLOOR_MS = "0"; // the floor has its own test; 100 guesses at 250 ms is 25 s
process.env.FOLDRUN_OPEN_SIGNUP = "1";
process.env.FOLDRUN_RESEND_API_KEY = "re_test_login_code";
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

const PASSWORD = "a long enough password here 1";
const json = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

/** Resend, captured: who was mailed what. */
const mails: Array<{ to: string; subject: string; text: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith("https://api.resend.com/")) {
    const b = JSON.parse(String(init?.body ?? "{}")) as { to: string | string[]; subject: string; text: string };
    mails.push({ to: ([] as string[]).concat(b.to)[0], subject: b.subject, text: b.text });
    return new Response(JSON.stringify({ id: "m_1" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function world() {
  const { migrate, orm } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const users = await import("../server/users.ts");
  const request = await import("../app/v1/auth/login/code/route.ts");
  const verify = await import("../app/v1/auth/login/code/verify/route.ts");
  const codes = await import("../server/login-codes.ts");
  const sessions = await import("../server/sessions.ts");
  const audit = await import("../server/audit.ts");
  const loginRoute = await import("../app/v1/auth/login/route.ts");
  const mfaVerify = await import("../app/v1/auth/mfa/verify/route.ts");
  const tokens = await import("../server/auth-tokens.ts");
  const totpMod = await import("../server/totp.ts");

  /** A person with a verified address (or not), on an account of their own. */
  async function person(label: string, verified = true) {
    const tenant = `lc${label}${Date.now().toString(36)}`;
    const email = `owner@${tenant}.test`;
    const user = await users.createUser(email, PASSWORD, tenant, { request: "free" });
    if (verified) await users.setEmailVerified(user.id);
    return { tenant, email, user };
  }
  /** A browser: its own challenge cookie, held across the two steps. */
  const browser = () => {
    const challenge = codes.newChallenge();
    return { challenge, cookie: `${codes.CHALLENGE_COOKIE}=${challenge}` };
  };
  const ask = async (email: string, b: { cookie: string }) => {
    const res = await request.POST(new NextRequest("http://x/v1/auth/login/code", json({ email }, b.cookie)));
    await Promise.all([...request.inflight]);
    return res;
  };
  const answer = (email: string, code: string, b: { cookie: string }) =>
    verify.POST(new NextRequest("http://x/v1/auth/login/code/verify", json({ email, code }, b.cookie)));
  const codeFrom = (to: string) => {
    const m = [...mails].reverse().find((x) => x.to === to);
    return m?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  };
  const row = async (userId: string) => (await orm()!.execute(`SELECT code_failed_run AS run, code_locked_until AS lock FROM users WHERE id = '${userId}'`)).rows[0] as { run: number; lock: string | null };
  return { orm, NextRequest, users, request, verify, codes, sessions, audit, loginRoute, mfaVerify, tokens, totpMod, person, browser, ask, answer, codeFrom, row };
}

test("every address gets the same answer; only a verified one is mailed, and the code is in the body, not the subject", opts, async () => {
  const w = await world();
  const known = await w.person("a");
  const unverified = await w.person("u", false);
  const b = w.browser();
  const before = mails.length;
  const answers = [];
  for (const email of [known.email, "nobody@nowhere.test", unverified.email]) {
    const res = await w.ask(email, b);
    answers.push([res.status, await res.json()]);
    assert.match(res.headers.get("set-cookie") ?? "", /foldrun_login_challenge=/, "a challenge cookie either way");
  }
  assert.deepEqual(answers, [[200, { ok: true }], [200, { ok: true }], [200, { ok: true }]]);
  const sent = mails.slice(before);
  assert.equal(sent.length, 1, "one mail: the verified address");
  assert.equal(sent[0].to, known.email);
  assert.match(sent[0].text, /\b\d{6}\b/);
  assert.doesNotMatch(sent[0].subject, /\d{6}/);
  assert.match(sent[0].text, /5 minutes/);
  assert.ok(!(await w.users.findUser(unverified.email))?.emailVerifiedAt);
});

test("the right code signs in once, only from the browser that asked; the session and the audit line say email-code; the address is not marked verified by it", opts, async () => {
  const w = await world();
  const p = await w.person("b");
  const mine = w.browser();
  const other = w.browser();
  await w.ask(p.email, mine);
  const code = w.codeFrom(p.email)!;
  // Another browser, the right code: refused, and it counts for nothing.
  const wrongPlace = await w.answer(p.email, code, other);
  assert.equal(wrongPlace.status, 401);
  assert.equal((await w.row(p.user.id)).run, 0, "a guess from another browser does not count");
  const ok = await w.answer(p.email, code, mine);
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.match(ok.headers.get("set-cookie") ?? "", /foldrun_session=/);
  const body = (await ok.json()) as { ok: boolean; tenant: string };
  assert.equal(body.tenant, p.tenant);
  assert.equal((await w.sessions.listSessions(p.user.id))[0].method, "email-code");
  const entry = (await w.audit.queryAudit({ tenant: p.tenant, limit: 20 })).entries.find((e) => e.action === "login");
  assert.deepEqual(entry?.detail, { method: "email-code" });
  // Once.
  assert.equal((await w.answer(p.email, code, mine)).status, 401, "a spent code does not work again");
});

test("a password sign-in records its method too", opts, async () => {
  const w = await world();
  const p = await w.person("c");
  const res = await w.loginRoute.POST(new w.NextRequest("http://x/v1/auth/login", json({ email: p.email, password: PASSWORD })));
  assert.equal(res.status, 200);
  assert.equal((await w.sessions.listSessions(p.user.id))[0].method, "password");
  const entry = (await w.audit.queryAudit({ tenant: p.tenant, limit: 20 })).entries.find((e) => e.action === "login");
  assert.deepEqual(entry?.detail, { method: "password" });
});

test("three wrong guesses spend the code; the right one then fails; every failure is one answer", opts, async () => {
  const w = await world();
  const p = await w.person("d");
  const b = w.browser();
  await w.ask(p.email, b);
  const code = w.codeFrom(p.email)!;
  const wrong = code === "000000" ? "111111" : "000000";
  const failures = [];
  assert.equal(w.codes.MAX_WRONG, 3);
  for (let i = 0; i < w.codes.MAX_WRONG; i++) {
    const r = await w.answer(p.email, wrong, b);
    failures.push([r.status, await r.json()]);
  }
  assert.equal((await w.row(p.user.id)).run, 3);
  const afterSpent = await w.answer(p.email, code, b);
  failures.push([afterSpent.status, await afterSpent.json()]);
  // Unknown address, unverified address, no cookie: the same words.
  const unknown = await w.answer("nobody@nowhere.test", wrong, b);
  failures.push([unknown.status, await unknown.json()]);
  const unverified = await w.person("e", false);
  const noCookie = await w.answer(unverified.email, "123456", { cookie: "" });
  failures.push([noCookie.status, await noCookie.json()]);
  for (const f of failures) assert.deepEqual(f, [401, { error: w.codes.CODE_FAILED }]);
});

test("every refusal takes at least the floor: an unknown address, a wrong guess and a spent code alike", opts, async () => {
  const w = await world();
  const p = await w.person("f");
  const b = w.browser();
  await w.ask(p.email, b);
  const code = w.codeFrom(p.email)!;
  const wrong = code === "000000" ? "111111" : "000000";
  process.env.FOLDRUN_CODE_FAIL_FLOOR_MS = "120";
  try {
    const timed = async (email: string, c: string, br: { cookie: string }) => {
      const t0 = performance.now();
      const r = await w.answer(email, c, br);
      return [r.status, performance.now() - t0] as const;
    };
    const cases = [
      await timed("nobody@nowhere.test", wrong, b), // unknown
      await timed(p.email, wrong, b), // wrong guess at a live code
      await timed(p.email, wrong, w.browser()), // known, no code for this browser
      await timed(p.email, "12", { cookie: "" }), // no challenge at all
    ];
    for (const [status, ms] of cases) {
      assert.equal(status, 401);
      assert.ok(ms >= 115, `a refusal answered in ${ms.toFixed(1)} ms, under the 120 ms floor`);
    }
    // The right code still signs in under the floor.
    assert.equal((await w.answer(p.email, code, b)).status, 200);
  } finally {
    process.env.FOLDRUN_CODE_FAIL_FLOOR_MS = "0";
  }
});

test("a code expires after five minutes, and a new one waits 30 seconds", opts, async () => {
  const w = await world();
  const p = await w.person("f");
  const b = w.browser();
  const t0 = Date.now();
  assert.equal(w.codes.CODE_MS, 5 * 60_000);
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0), "sent");
  const code = w.codeFrom(p.email)!;
  // Still good a moment before five minutes (the code is kept, so the check is a dry one: a wrong guess).
  const wrongOf = code === "000000" ? "111111" : "000000";
  assert.deepEqual(await w.codes.verifyCode(p.email, wrongOf, b.challenge, t0 + w.codes.CODE_MS - 1), { ok: false, reason: "wrong" });
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0 + 10_000), "not sent", "inside 30 s: no second code");
  assert.deepEqual(await w.codes.verifyCode(p.email, code, b.challenge, t0 + w.codes.CODE_MS + 1), { ok: false, reason: "expired" });
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0 + 31_000), "sent", "after 30 s: a new code");
  const fresh = w.codeFrom(p.email)!;
  assert.deepEqual(await w.codes.verifyCode(p.email, fresh, b.challenge, t0 + 40_000), { ok: true, userId: p.user.id });
});

test("100 wrong in a row lock code sign-in for 15 minutes; the password still works", opts, async () => {
  const w = await world();
  const p = await w.person("g");
  const b = w.browser();
  const t0 = Date.now();
  await w.codes.requestCode(p.email, b.challenge, t0);
  const code = w.codeFrom(p.email)!;
  await w.orm()!.execute(`UPDATE users SET code_failed_run = ${w.codes.LOCK_AFTER - 1}, code_failed_at = now() WHERE id = '${p.user.id}'`);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.deepEqual(await w.codes.verifyCode(p.email, wrong, b.challenge, t0 + 1_000), { ok: false, reason: "locked" });
  assert.deepEqual(await w.codes.verifyCode(p.email, code, b.challenge, t0 + 2_000), { ok: false, reason: "locked" }, "even the right code, while locked");
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0 + 40_000), "not sent", "and no new code while locked");
  const pw = await w.loginRoute.POST(new w.NextRequest("http://x/v1/auth/login", json({ email: p.email, password: PASSWORD })));
  assert.equal(pw.status, 200, "the password is not locked");
  // After the lock, a new code works and clears the run.
  const later = t0 + w.codes.LOCK_MS + 60_000;
  assert.equal(await w.codes.requestCode(p.email, b.challenge, later), "sent");
  assert.deepEqual(await w.codes.verifyCode(p.email, w.codeFrom(p.email)!, b.challenge, later + 1_000), { ok: true, userId: p.user.id });
  assert.equal((await w.row(p.user.id)).run, 0);
});

test("a run of wrong codes older than an hour is forgotten: 99 wrong long ago, one more, no lock; 99 wrong just now, one more, locked", opts, async () => {
  const w = await world();
  const p = await w.person("rw");
  const b = w.browser();
  const t0 = Date.now();
  await w.codes.requestCode(p.email, b.challenge, t0);
  const code = w.codeFrom(p.email)!;
  const wrong = code === "000000" ? "111111" : "000000";
  const set = (ago: number | null) =>
    w.orm()!.execute(`UPDATE users SET code_failed_run = ${w.codes.LOCK_AFTER - 1}, code_failed_at = ${ago === null ? "NULL" : `now() - interval '${ago} seconds'`} WHERE id = '${p.user.id}'`);
  await set(w.codes.RUN_WINDOW_MS / 1000 + 60);
  assert.deepEqual(await w.codes.verifyCode(p.email, wrong, b.challenge, t0 + 1_000), { ok: false, reason: "wrong" });
  assert.equal((await w.row(p.user.id)).run, 1, "started again from one");
  await set(null);
  assert.deepEqual(await w.codes.verifyCode(p.email, wrong, b.challenge, t0 + 2_000), { ok: false, reason: "wrong" }, "a run with no stamp (from before the column) is stale too");
  await set(60);
  assert.deepEqual(await w.codes.verifyCode(p.email, wrong, b.challenge, t0 + 3_000), { ok: false, reason: "locked" }, "a fresh run still locks at 100");
});

test("at most six code mails an hour per address: the seventh browser gets the same 200 and nothing", opts, async () => {
  const w = await world();
  const p = await w.person("h");
  const before = mails.length;
  for (let i = 0; i < 7; i++) {
    const res = await w.ask(p.email, w.browser());
    assert.equal(res.status, 200);
  }
  assert.equal(mails.length - before, 6);
});

test("one caller spending an address's six mails does not stop the owner's own request; all callers together stop at thirty", opts, async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const w = await world();
    const p = await w.person("lim");
    const from = async (ip: string) => {
      const b = w.browser();
      const res = await w.request.POST(new w.NextRequest("http://x/v1/auth/login/code", { ...json({ email: p.email }, b.cookie), headers: { "content-type": "application/json", cookie: b.cookie, "x-forwarded-for": ip } }));
      await Promise.all([...w.request.inflight]);
      return res.status;
    };
    const before = mails.length;
    for (let i = 0; i < 8; i++) assert.equal(await from("203.0.113.9"), 200);
    assert.equal(mails.length - before, 6, "the stranger's seventh and eighth send nothing");
    assert.equal(await from("198.51.100.7"), 200);
    assert.equal(mails.length - before, 7, "the owner, from another address, is still mailed");
    for (let i = 0; i < 30; i++) await from(`192.0.2.${i + 1}`);
    assert.ok(mails.length - before <= 30, "no more than thirty in an hour, whoever asks");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("a second factor is still asked after the code, and the session records the code as the way in", opts, async () => {
  const w = await world();
  const p = await w.person("i");
  const secret = "JBSWY3DPEHPK3PXP";
  await w.users.setMfa(p.user.id, { secret, backupHashes: [] });
  const b = w.browser();
  await w.ask(p.email, b);
  const res = await w.answer(p.email, w.codeFrom(p.email)!, b);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.headers.get("set-cookie") ?? "", /foldrun_session=[^;]/, "no session yet");
  const body = (await res.json()) as { mfa?: boolean; challenge?: string };
  assert.equal(body.mfa, true);
  assert.equal(w.tokens.readToken("mfa-challenge", body.challenge!)?.m, "email-code");
  const done = await w.mfaVerify.POST(new w.NextRequest("http://x/v1/auth/mfa/verify", json({ challenge: body.challenge, code: w.totpMod.totp(secret) })));
  assert.equal(done.status, 200, await done.clone().text());
  assert.equal((await w.sessions.listSessions(p.user.id))[0].method, "email-code");
  const entry = (await w.audit.queryAudit({ tenant: p.tenant, limit: 20 })).entries.find((e) => e.action === "login");
  assert.deepEqual(entry?.detail, { mfa: "totp", method: "email-code" });
});

test("without a mail credential the two routes answer 404 and the page hides the switch", opts, async () => {
  const w = await world();
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    assert.equal(w.codes.codeSignInAvailable(), false);
    assert.equal((await w.ask("a@b.test", w.browser())).status, 404);
    assert.equal((await w.answer("a@b.test", "123456", w.browser())).status, 404);
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = key;
  }
  assert.equal(w.codes.codeSignInAvailable(), true);
});

test("the install-wide mail budget is spent by real accounts only: an unknown or unverified address never asks for it, and a refused budget leaves no usable code", opts, async () => {
  const w = await world();
  const p = await w.person("g");
  const b = w.browser();
  let asked = 0;
  const budget = (answer: boolean) => async () => {
    asked++;
    return answer;
  };
  assert.equal(await w.codes.requestCode("nobody@nowhere.test", b.challenge, Date.now(), budget(true)), "not sent");
  const unverified = await w.person("h", false);
  assert.equal(await w.codes.requestCode(unverified.email, b.challenge, Date.now(), budget(true)), "not sent");
  assert.equal(asked, 0, "made-up and unverified addresses do not touch the budget");
  // Out of budget: nothing mailed, and the code that was made cannot sign anyone in.
  const t0 = Date.now();
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0, budget(false)), "not sent");
  assert.equal(asked, 1);
  assert.equal(w.codeFrom(p.email), null, "no mail left");
  assert.deepEqual((await w.codes.verifyCode(p.email, "000000", b.challenge, t0 + 40_000)).ok, false);
  // With budget the next request (after the 30 s throttle) is mailed and works.
  assert.equal(await w.codes.requestCode(p.email, b.challenge, t0 + 31_000, budget(true)), "sent");
  assert.deepEqual(await w.codes.verifyCode(p.email, w.codeFrom(p.email)!, b.challenge, t0 + 40_000), { ok: true, userId: p.user.id });
});

// ---- the per-client gate (server/code-gate.ts), through the real routes ----

const SECRET = "edge-secret-for-the-test";
/** A request through our edge: stamped, with the client's address. */
const viaEdge = (ip: string, b: { cookie: string }, body: unknown, stamped = true) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: b.cookie,
    "cf-connecting-ip": ip,
    ...(stamped ? { "x-foldrun-edge": SECRET } : {}),
  },
  body: JSON.stringify(body),
});
async function gateWorld() {
  const w = await world();
  const gate = await import("../server/code-gate.ts");
  gate.resetCodeGate();
  const from = (ip: string, email: string, code: string, b: { cookie: string }, stamped = true) =>
    w.verify.POST(new w.NextRequest("http://x/v1/auth/login/code/verify", viaEdge(ip, b, { email, code }, stamped)));
  return { w, gate, from };
}
const edgeEnv = <T>(f: () => Promise<T>) => {
  const old = [process.env.FOLDRUN_TRUST_PROXY, process.env.FOLDRUN_EDGE_SECRET];
  process.env.FOLDRUN_TRUST_PROXY = "cloudflare";
  process.env.FOLDRUN_EDGE_SECRET = SECRET;
  return f().finally(() => {
    for (const [k, v] of [["FOLDRUN_TRUST_PROXY", old[0]], ["FOLDRUN_EDGE_SECRET", old[1]]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
};

test("four failures from one client, across different addresses, block it: even the right code is then refused in the same words", opts, async () => {
  await edgeEnv(async () => {
    const { w, gate, from } = await gateWorld();
    const p = await w.person("ip1");
    const b = w.browser();
    await w.ask(p.email, b);
    const code = w.codeFrom(p.email)!;
    const ip = "203.0.113.50";
    for (const email of ["a@nowhere.test", "b@nowhere.test", "c@nowhere.test", "d@nowhere.test"]) {
      const r = await from(ip, email, "000000", b);
      assert.deepEqual([r.status, await r.json()], [401, { error: w.codes.CODE_FAILED }]);
    }
    assert.equal(await gate.codeGateBlocked(ip), true);
    const refused = await from(ip, p.email, code, b);
    assert.deepEqual([refused.status, await refused.json()], [401, { error: w.codes.CODE_FAILED }], "the right code, from the blocked client");
    // Another client, the same code: it signs in (the block was the client's, not the code's).
    const other = await from("203.0.113.51", p.email, code, b);
    assert.equal(other.status, 200);
  });
});

test("a blocked client is mailed nothing either, and gets the same 200", opts, async () => {
  await edgeEnv(async () => {
    const { w, gate, from } = await gateWorld();
    const p = await w.person("ip2");
    const b = w.browser();
    const ip = "203.0.113.52";
    for (let i = 0; i < gate.FAILURES; i++) await from(ip, `x${i}@nowhere.test`, "000000", b);
    const before = mails.length;
    const res = await w.request.POST(new w.NextRequest("http://x/v1/auth/login/code", viaEdge(ip, b, { email: p.email })));
    await Promise.all([...w.request.inflight]);
    assert.deepEqual([res.status, await res.json()], [200, { ok: true }]);
    assert.equal(mails.length, before, "no mail for a blocked client");
  });
});

test("IPv6 failures are counted by the /64: four different addresses inside one block it", opts, async () => {
  await edgeEnv(async () => {
    const { w, gate, from } = await gateWorld();
    const b = w.browser();
    const inside = ["2001:db8:aa:bb::1", "2001:db8:aa:bb:1:2:3:4", "2001:db8:aa:bb:ffff::9", "2001:db8:aa:bb::beef"];
    for (const ip of inside) await from(ip, "nobody@nowhere.test", "000000", b);
    assert.equal(await gate.codeGateBlocked(gate.gateKey("2001:db8:aa:bb::7")!), true, "any address in the /64 is blocked");
    assert.equal(await gate.codeGateBlocked(gate.gateKey("2001:db8:aa:bc::7")!), false, "the next /64 is not");
  });
});

test("a header the edge did not stamp is ignored: no stamp, no block, however many failures and whatever it claims", opts, async () => {
  await edgeEnv(async () => {
    const { w, gate, from } = await gateWorld();
    const p = await w.person("ip3");
    const b = w.browser();
    await w.ask(p.email, b);
    const code = w.codeFrom(p.email)!;
    const claimed = "203.0.113.53";
    for (let i = 0; i < 6; i++) await from(claimed, `y${i}@nowhere.test`, "000000", b, false);
    assert.equal(await gate.codeGateBlocked(claimed), false, "nothing was counted under the claimed address");
    const ok = await from(claimed, p.email, code, b, false);
    assert.equal(ok.status, 200, "the right code still signs in");
  });
});

test("no trustworthy address at all: the gate is off and the per-address limits stand alone, never one shared bucket", opts, async () => {
  const { w, gate } = await gateWorld();
  const p = await w.person("ip4");
  const b = w.browser();
  await w.ask(p.email, b);
  const code = w.codeFrom(p.email)!;
  for (let i = 0; i < 6; i++) await w.answer(`z${i}@nowhere.test`, "000000", b);
  assert.equal(await gate.codeGateBlocked("unknown"), false);
  assert.equal((await w.answer(p.email, code, b)).status, 200, "six strangers' failures do not block the next person");
});
