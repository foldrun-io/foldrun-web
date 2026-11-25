// A key minted for a person, and a member's removal, both run under the people lock and write the
// keys in the lock's own transaction (FOL-320, Codex): with ONE database connection they still finish
// — a second connection taken while the lock holds the first would wait forever.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/people-lock-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres", timeout: 20_000 };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-people-lock-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
process.env.FOLDRUN_DATABASE_POOL = "1";
delete process.env.FOLDRUN_RESEND_API_KEY;
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

test("one connection: a person's key is minted, and their removal revokes it in the same transaction", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const users = await import("../server/users.ts");
  const auth = await import("../server/auth.ts");
  const stamp = Date.now().toString(36);
  const tenant = `lock${stamp}`;
  const owner = await users.createUser(`owner@${tenant}.test`, "a password long enough here 1", tenant, { request: "free" });
  const m = await users.createUser(`member@${tenant}.test`, "a password long enough here 2", tenant, { joining: true, role: "editor" });
  const k = await auth.createApiKey(tenant, "theirs", m.email, undefined, "editor", null, { personBound: {} });
  const removed = await users.removeMember(tenant, m.id, owner.id, owner.email, "owner");
  assert.ok(removed && removed.keysRevoked.includes(k.record.id));
  assert.ok((await auth.listApiKeys(tenant)).find((x) => x.id === k.record.id)?.revokedAt);
});

test("one connection: a key is minted only while the session that asked is live — a reset that ended it refuses the mint", opts, async () => {
  const users = await import("../server/users.ts");
  const auth = await import("../server/auth.ts");
  const sessions = await import("../server/sessions.ts");
  const tenant = `sess${Date.now().toString(36)}`;
  const u = await users.createUser(`owner@${tenant}.test`, "a password long enough here 3", tenant, { request: "free" });
  await users.setEmailVerified(u.id);
  const minted = await users.mintSession(u, "laptop");
  const session = (await users.verifySession(minted.value))!.session!;
  assert.equal(session.kind, "v2");
  assert.ok(session.id, "a v2 session names its row");
  assert.ok((await auth.createApiKey(tenant, "live", u.email, undefined, "editor", null, { personBound: { credential: { session: session.id!, user: u.id } } })).key);
  await sessions.revokeSessions(u.id);
  await assert.rejects(auth.createApiKey(tenant, "late", u.email, undefined, "editor", null, { personBound: { credential: { session: session.id!, user: u.id } } }), (e: unknown) => (e as { status?: number }).status === 409);
});

test("one connection: an MCP grant is read in the lock's own transaction — a gone grant mints nothing, and nothing is left behind", opts, async () => {
  const users = await import("../server/users.ts");
  const auth = await import("../server/auth.ts");
  const tenant = `grant${Date.now().toString(36)}`;
  const u = await users.createUser(`owner@${tenant}.test`, "a password long enough here 4", tenant, { request: "free" });
  await users.setEmailVerified(u.id);
  await assert.rejects(auth.createApiKey(tenant, "by gone grant", u.email, undefined, "editor", null, { personBound: { credential: { grant: "nope", user: u.id } } }), (e: unknown) => (e as { status?: number }).status === 409);
  assert.equal((await auth.listApiKeys(tenant)).length, 0, "no row written");
});
