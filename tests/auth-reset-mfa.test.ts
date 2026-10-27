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
const { createAccountBySuperAdmin, setMfa, findUserById, SESSION_COOKIE } = await import("../server/users.ts");
const { mintToken, hashFingerprint, RESET_TTL_MS } = await import("../server/auth-tokens.ts");
const reset = await import("../app/api/auth/reset/route.ts");

const post = (token: string, password: string) =>
  reset.POST(new NextRequest("http://x/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) }));
const linkFor = async (id: string) => {
  const u = (await findUserById(id))!;
  return mintToken("reset", { u: u.id, h: hashFingerprint(u.hash) }, RESET_TTL_MS);
};

test("with MFA on, a reset changes the password but sets no session", async () => {
  const u = await createAccountBySuperAdmin("mfa@reset.test", "an old password long enough 1", "reset-mfa");
  await setMfa(u.id, { secret: "JBSWY3DPEHPK3PXP", backupHashes: [] });
  const r = await post(await linkFor(u.id), "a brand new password, long 2");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, account: "reset-mfa", signIn: true });
  assert.equal(r.cookies.get(SESSION_COOKIE), undefined, "no session: the second factor is still owed");
  assert.notEqual((await findUserById(u.id))!.hash, u.hash, "the password did change");
});

test("without MFA, a reset still signs the person in", async () => {
  const u = await createAccountBySuperAdmin("plain@reset.test", "an old password long enough 3", "reset-plain");
  const r = await post(await linkFor(u.id), "a brand new password, long 4");
  assert.equal(r.status, 200);
  assert.ok(r.cookies.get(SESSION_COOKIE)?.value, "signed in, as before");
});
