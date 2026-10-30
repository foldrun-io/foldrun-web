// A session remembers which surface it was made for and whether a second
// factor was done (27 Oct 2026) — facts kept on the session's own row.
// Stored in the sessions row, so this runs against Postgres.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/session-audience-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-session-audience-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

test("a console session is stored with its surface and its second factor; a plain one with neither", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  // Fixtures: several accounts, each its own owner — signup stays open for them.
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const { createUser, mintSession, verifySession } = await import("../server/users.ts");
  const tenant = `aud${Date.now()}`;
  const user = await createUser(`op@${tenant}.test`, "a long enough password here 1", tenant);
  const consoleToken = await mintSession(user, "test", { audience: "admin", mfa: true });
  assert.match(consoleToken.value, /^v2\./, "revocable: the facts live in the row");
  assert.deepEqual((await verifySession(consoleToken.value))?.session, { kind: "v2", audience: "admin", mfa: true });
  const plain = await mintSession(user, "test");
  assert.deepEqual((await verifySession(plain.value))?.session, { kind: "v2", audience: null, mfa: false });
  const appMfa = await mintSession(user, "test", { mfa: true });
  assert.deepEqual((await verifySession(appMfa.value))?.session, { kind: "v2", audience: null, mfa: true });
});
