// Handing over the account asks for the owner again (30 Oct 2026), as a
// password or email change does: the current password, and a code from the
// app (or a backup code) when two-step sign-in is on. A borrowed or stolen
// owner session used to transfer ownership with the session alone.
//
//   node --import ./tests/register.mjs --test tests/team-transfer-reauth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-transfer-reauth-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_RESEND_API_KEY;

const { NextRequest } = await import("next/server");
const { createUser, mintSession, setMfa, ownerOf, SESSION_COOKIE } = await import("../server/users.ts");
const { totp } = await import("../server/totp.ts");
const transfer = await import("../app/api/team/transfer/route.ts");

const PW = "a long enough password 1";
const cookieOf = async (u: Parameters<typeof mintSession>[0]) => `${SESSION_COOKIE}=${(await mintSession(u)).value}`;
const ask = (cookie: string, body: unknown) =>
  transfer.POST(new NextRequest("http://x/api/team/transfer", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));

test("a session alone no longer hands the account over: the password is asked, and checked", async () => {
  const owner = await createUser("owner@transfer.test", PW, "transfer-a");
  const member = await createUser("next@transfer.test", PW, "transfer-a", { joining: true, role: "admin" });
  const cookie = await cookieOf(owner);

  const bare = await ask(cookie, { to: member.id });
  assert.equal(bare.status, 400);
  assert.match(((await bare.json()) as { error: string }).error, /password/);
  assert.equal((await ask(cookie, { to: member.id, password: "not it" })).status, 401);
  assert.equal((await ownerOf("transfer-a"))?.id, owner.id, "nothing moved");

  const ok = await ask(cookie, { to: member.id, password: PW });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ownerOf("transfer-a"))?.id, member.id);
});

test("with two-step sign-in on, a code from the app is asked too", async () => {
  const owner = await createUser("mfa-owner@transfer.test", PW, "transfer-b");
  const member = await createUser("mfa-next@transfer.test", PW, "transfer-b", { joining: true, role: "admin" });
  const secret = "JBSWY3DPEHPK3PXP";
  await setMfa(owner.id, { secret, backupHashes: [] });
  const cookie = await cookieOf(owner);

  assert.equal((await ask(cookie, { to: member.id, password: PW })).status, 400, "no code");
  assert.equal((await ask(cookie, { to: member.id, password: PW, code: "000000" === totp(secret) ? "111111" : "000000" })).status, 401, "a wrong code");
  assert.equal((await ownerOf("transfer-b"))?.id, owner.id);
  const ok = await ask(cookie, { to: member.id, password: PW, code: totp(secret) });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ownerOf("transfer-b"))?.id, member.id);
});

test("wrong passwords are limited: the seventh in a quarter hour is a 429", async () => {
  const owner = await createUser("grind@transfer.test", PW, "transfer-c");
  const member = await createUser("grind-next@transfer.test", PW, "transfer-c", { joining: true, role: "admin" });
  const cookie = await cookieOf(owner);
  for (let i = 0; i < 6; i++) assert.equal((await ask(cookie, { to: member.id, password: `wrong ${i}` })).status, 401);
  assert.equal((await ask(cookie, { to: member.id, password: PW })).status, 429);
});
