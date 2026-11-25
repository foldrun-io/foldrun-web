// A reset link proves the inbox, not the second factor (27 Oct 2026): for a
// user with MFA it changes the password and ends their sessions, but signs
// nobody in — the login asks for the code. Without MFA it signs in, as before.
//
//   node --import ./tests/register.mjs --test tests/auth-reset-mfa.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-reset-mfa-"));
process.env.FOLDRUN_SECRET_KEY = "reset-mfa-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
const { NextRequest } = await import("next/server");
// Fixtures: several accounts, each its own owner — signup stays open for them.
process.env.FOLDRUN_OPEN_SIGNUP = "1";
const { createUser, setMfa, findUserById, setEmailVerified, SESSION_COOKIE } = await import("../server/users.ts");
const { mintToken, hashFingerprint, RESET_TTL_MS } = await import("../server/auth-tokens.ts");
const reset = await import("../app/v1/auth/reset/route.ts");

const post = (token: string, password: string) =>
  reset.POST(new NextRequest("http://x/v1/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) }));
const linkFor = async (id: string) => {
  const u = (await findUserById(id))!;
  return mintToken("reset", { u: u.id, h: hashFingerprint(u.hash), e: u.email }, RESET_TTL_MS);
};

test("a reset link is for the address it was sent to: one without it, or for another, is refused", async () => {
  const u = await createUser("bound@reset.test", "an old password long enough 5", "reset-bound", { request: "free" });
  const noEmail = mintToken("reset", { u: u.id, h: hashFingerprint(u.hash) }, RESET_TTL_MS);
  assert.equal((await post(noEmail, "a brand new password, long 6")).status, 400);
  const oldInbox = mintToken("reset", { u: u.id, h: hashFingerprint(u.hash), e: "old@reset.test" }, RESET_TTL_MS);
  assert.equal((await post(oldInbox, "a brand new password, long 7")).status, 400);
  assert.equal((await findUserById(u.id))!.hash, u.hash, "the password did not change");
});

test("with MFA on, a reset changes the password but sets no session", async () => {
  const u = await createUser("mfa@reset.test", "an old password long enough 1", "reset-mfa", { request: "free" });
  await setEmailVerified(u.id);
  await setMfa(u.id, { secret: "JBSWY3DPEHPK3PXP", backupHashes: [] });
  const r = await post(await linkFor(u.id), "a brand new password, long 2");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, account: "reset-mfa", signIn: true });
  assert.equal(r.cookies.get(SESSION_COOKIE), undefined, "no session: the second factor is still owed");
  assert.notEqual((await findUserById(u.id))!.hash, u.hash, "the password did change");
});

test("FOL-316: a sign-in challenge won before a reset is refused after it", async () => {
  const mfaVerify = await import("../app/v1/auth/mfa/verify/route.ts");
  const { CHALLENGE_TTL_MS } = await import("../server/auth-tokens.ts");
  const u = await createUser("challenge@reset.test", "an old password long enough 8", "reset-challenge", { request: "free" });
  await setEmailVerified(u.id);
  await setMfa(u.id, { secret: "JBSWY3DPEHPK3PXP", backupHashes: [] });
  const before = (await findUserById(u.id))!;
  const challenge = mintToken("mfa-challenge", { u: u.id, h: hashFingerprint(before.hash) }, CHALLENGE_TTL_MS);
  assert.equal((await post(await linkFor(u.id), "a brand new password, long 9")).status, 200);
  const { totp } = await import("../server/totp.ts");
  const r = await mfaVerify.POST(new NextRequest("http://x/v1/auth/mfa/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge, code: totp("JBSWY3DPEHPK3PXP") }) }));
  assert.equal(r.status, 401, "the challenge named the old password");
  const unbound = mintToken("mfa-challenge", { u: u.id }, CHALLENGE_TTL_MS);
  const r2 = await mfaVerify.POST(new NextRequest("http://x/v1/auth/mfa/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: unbound, code: totp("JBSWY3DPEHPK3PXP") }) }));
  assert.equal(r2.status, 401, "a challenge bound to no password is refused");
});

test("FOL-316: two uses of one link at once: one reset, the other refused", async () => {
  const u = await createUser("race@reset.test", "an old password long enough 7", "reset-race", { request: "free" });
  await setEmailVerified(u.id);
  const link = await linkFor(u.id);
  const [a, b] = await Promise.all([post(link, "first new password, long 10"), post(link, "second new password, long 11")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
});

test("without MFA, a reset still signs the person in", async () => {
  const u = await createUser("plain@reset.test", "an old password long enough 3", "reset-plain", { request: "free" });
  const r = await post(await linkFor(u.id), "a brand new password, long 4");
  assert.equal(r.status, 200);
  assert.ok(r.cookies.get(SESSION_COOKIE)?.value, "signed in, as before");
});

test("a bound MFA secret opens only for its own person; the old form still opens", async () => {
  const { sealString, openString, mfaBinding, mfaEnrolBinding } = await import("../server/users.ts");
  const legacy = sealString("JBSWY3DPEHPK3PXP", mfaBinding("u1"));
  assert.ok(!legacy.startsWith("s2."), "unbound until the install writes bound records");
  assert.equal(openString(legacy, mfaBinding("u2")), "JBSWY3DPEHPK3PXP");
  process.env.FOLDRUN_VAULT_WRITE_BOUND = "1";
  try {
    const bound = sealString("JBSWY3DPEHPK3PXP", mfaBinding("u1"));
    assert.ok(bound.startsWith("s2."));
    assert.equal(openString(bound, mfaBinding("u1")), "JBSWY3DPEHPK3PXP");
    assert.throws(() => openString(bound, mfaBinding("u2")), "another person's row");
    assert.throws(() => openString(bound, mfaEnrolBinding("u1")), "an enrol token is not a stored secret");
    assert.throws(() => openString(bound), "no binding");
  } finally {
    delete process.env.FOLDRUN_VAULT_WRITE_BOUND;
  }
});
