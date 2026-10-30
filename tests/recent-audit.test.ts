// recentAudit() is an account's own log, newest first: the operator's levers
// on the account (`operator.*`) are the platform's record and not in it —
// the same with a database as without one. Until 30 Oct 2026 the database
// path read audit_log directly and returned them too (Codex review).
//
//   node --import ./tests/register.mjs --test tests/recent-audit.test.ts
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/recent-audit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-recent-audit-"));
process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
const savedDb = { url: process.env.FOLDRUN_DATABASE_URL, password: process.env.FOLDRUN_DATABASE_PASSWORD };
delete process.env.FOLDRUN_DATABASE_URL;

const { audit, recentAudit } = await import("../server/audit.ts");

/** Three of the account's own entries around two operator levers, then
 *  what recentAudit hands back. */
async function writeAndRead(tenant: string) {
  await audit("login", { actor: "owner@acme.test", tenant });
  await audit("operator.notes" as never, { actor: "boss@foldrun.test", tenant, detail: { notes: "internal" } });
  await audit("apikey.created", { actor: "owner@acme.test", tenant, subject: "k1" });
  await audit("operator.credit" as never, { actor: "boss@foldrun.test", tenant, detail: { usd: 5 } });
  await audit("logout", { actor: "owner@acme.test", tenant });
  return recentAudit(tenant);
}

const expectOwnOnly = (entries: { action: string; actor: string }[]) => {
  assert.deepEqual(entries.map((e) => e.action), ["logout", "apikey.created", "login"], "the account's own, newest first");
  assert.ok(entries.every((e) => !e.action.startsWith("operator.")), "no operator lever");
  assert.ok(entries.every((e) => !("id" in e)), "no cursor id on a recent entry");
};

test("without a database: the account's own entries, no operator levers", async () => {
  expectOwnOnly(await writeAndRead("recent-file"));
});

test("a limit caps what comes back, after the operator levers are left out", async () => {
  const got = await recentAudit("recent-file", 2);
  assert.deepEqual(got.map((e) => e.action), ["logout", "apikey.created"]);
});

test("with a database: the same — the operator levers are left out there too", { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" }, async () => {
  const u = new URL(url!);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  try {
    const { migrate } = await import("@/platform/db.ts");
    await migrate();
    const tenant = `recent${Date.now()}`;
    expectOwnOnly(await writeAndRead(tenant));
  } finally {
    if (savedDb.url === undefined) delete process.env.FOLDRUN_DATABASE_URL;
    else process.env.FOLDRUN_DATABASE_URL = savedDb.url;
    if (savedDb.password === undefined) delete process.env.FOLDRUN_DATABASE_PASSWORD;
    else process.env.FOLDRUN_DATABASE_PASSWORD = savedDb.password;
  }
});
