// Turning on the second factor ends the person's other sessions, as a
// password or email change does (30 Oct 2026): a session stolen before
// enrolment used to keep working for its month after the owner added MFA.
// Sessions are revocable rows, so this runs against Postgres.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/mfa-enable-sessions-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mfa-enable-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
delete process.env.FOLDRUN_RESEND_API_KEY;
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

test("enabling MFA ends every other session and keeps this browser's", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const { NextRequest } = await import("next/server");
  const { createUser, mintSession, verifySession, sealString, mfaEnrolBinding, SESSION_COOKIE } = await import("../server/users.ts");
  const { mintToken, ENROL_TTL_MS } = await import("../server/auth-tokens.ts");
  const { totp } = await import("../server/totp.ts");
  const enable = await import("../app/api/auth/mfa/enable/route.ts");

  const tenant = `mfaon${Date.now()}`;
  const user = await createUser(`owner@${tenant}.test`, "a long enough password here 1", tenant);
  const stolen = await mintSession(user, "attacker");
  const mine = await mintSession(user, "owner's browser");

  const secret = "JBSWY3DPEHPK3PXP";
  const enrol = mintToken("mfa-enrol", { u: user.id, s: sealString(secret, mfaEnrolBinding(user.id)) }, ENROL_TTL_MS);
  const res = await enable.POST(new NextRequest("http://x/api/auth/mfa/enable", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${mine.value}` },
    body: JSON.stringify({ enrol, code: totp(secret) }),
  }));
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { backup: string[]; otherSessionsEnded: number };
  assert.equal(body.backup.length, 8);
  assert.equal(body.otherSessionsEnded, 1);
  assert.equal(await verifySession(stolen.value), null, "the session from before enrolment is over");
  assert.ok(await verifySession(mine.value), "the browser that turned it on stays signed in");
});
