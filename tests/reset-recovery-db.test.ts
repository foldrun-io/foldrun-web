// A reset link, used against Postgres (FOL-316): redeemed in one transaction
// under the users lock, so two uses at once give one reset, and every session
// ends in the same write.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/reset-recovery-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-reset-recovery-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_RESEND_API_KEY;
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

async function world() {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const users = await import("../server/users.ts");
  const tokens = await import("../server/auth-tokens.ts");
  const auth = await import("../server/auth.ts");
  const reset = await import("../app/v1/auth/reset/route.ts");
  const post = (token: string, password: string) =>
    reset.POST(new NextRequest("http://x/v1/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) }));
  const linkFor = async (id: string) => {
    const u = (await users.findUserById(id))!;
    return tokens.mintToken("reset", { u: u.id, h: tokens.hashFingerprint(u.hash), e: u.email }, tokens.RESET_TTL_MS);
  };
  return { users, auth, post, linkFor };
}

test("an unverified address: the reset verifies it and ends every session in the same write", opts, async () => {
  const w = await world();
  const tenant = `unv${Date.now().toString(36)}`;
  const u = await w.users.createUser(`person@${tenant}.test`, "the first signer's password 1", tenant, { request: "free" });
  const theirs = await w.users.mintSession(u, "the first signer");
  assert.ok(await w.users.verifySession(theirs.value));
  const r = await w.post(await w.linkFor(u.id), "the rightful owner's password 2");
  assert.equal(r.status, 200);
  assert.equal(await w.users.verifySession(theirs.value), null, "their session ended");
  assert.ok((await w.users.findUserById(u.id))!.emailVerifiedAt);
});

test("a verified address: a reset keeps the second factor and the keys, and ends the sessions; a second factor is still owed", opts, async () => {
  const w = await world();
  const tenant = `ver${Date.now().toString(36)}`;
  const u = await w.users.createUser(`owner@${tenant}.test`, "an old password long enough 3", tenant, { request: "free" });
  await w.users.setEmailVerified(u.id);
  const stolen = await w.users.mintSession(u, "stolen");
  await w.users.setMfa(u.id, { secret: "JBSWY3DPEHPK3PXP", backupHashes: [] });
  await w.auth.createApiKey(tenant, "their key", u.email);
  const r = await w.post(await w.linkFor(u.id), "a brand new password long 4");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, account: tenant, signIn: true }, "the second factor is still owed");
  assert.equal(await w.users.verifySession(stolen.value), null);
  assert.ok((await w.users.findUserById(u.id))!.mfaSecret, "MFA kept");
  assert.equal((await w.auth.listApiKeys(tenant)).filter((k) => !k.revokedAt).length, 1, "keys kept");
});

test("one link used twice at once: one reset, one refusal", opts, async () => {
  const w = await world();
  const tenant = `race${Date.now().toString(36)}`;
  const u = await w.users.createUser(`owner@${tenant}.test`, "an old password long enough 5", tenant, { request: "free" });
  await w.users.setEmailVerified(u.id);
  const link = await w.linkFor(u.id);
  const results = await Promise.all([w.post(link, "first new password long 6"), w.post(link, "second new password long 7"), w.post(link, "third new password long 8")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
});
