// Approving a `foldrun login` wins the request before any key exists
// (FOL-94). Two approvals at once used to mint two keys, and the loser's
// lived on — a working admin-level key delivered to nobody. The database
// path's claim is tested against Postgres (foldrun-platform
// postgres-live.test.ts); this is the file store, which has the same order.
//
//   node --import ./tests/register.mjs --test tests/cli-login-approve.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-approve-"));
delete process.env.FOLDRUN_DATABASE_URL;

const { beginCliLogin, decideCliLogin, pollCliLogin } = await import("../server/cli-login.ts");
const { listApiKeys } = await import("../server/auth.ts");

const person = { tenant: "acme", email: "owner@acme.test", role: "owner" as const, workspaces: null };

test("two approvals at once: one wins, one key is minted, and the CLI collects it once", async () => {
  const req = await beginCliLogin("laptop");
  assert.deepEqual(await pollCliLogin(req.id), { status: "pending" });
  const before = (await listApiKeys("acme")).length;

  const outcomes = await Promise.all([decideCliLogin(req.code, "approve", person), decideCliLogin(req.code, "approve", person)]);
  assert.deepEqual([...outcomes].sort(), ["approved", "not-found"]);
  assert.equal((await listApiKeys("acme")).length - before, 1, "exactly one key exists, the one the CLI gets");

  const got = await pollCliLogin(req.id);
  assert.equal(got.status, "approved");
  assert.deepEqual(await pollCliLogin(req.id), { status: "expired" }, "collected once");
});

test("a denial after an approval won is not-found, and mints nothing", async () => {
  const req = await beginCliLogin("desk");
  const before = (await listApiKeys("acme")).length;
  const [approve, deny] = await Promise.all([decideCliLogin(req.code, "approve", person), decideCliLogin(req.code, "deny", person)]);
  assert.equal(approve, "approved");
  assert.equal(deny, "not-found");
  assert.equal((await listApiKeys("acme")).length - before, 1);
});

test("two DIFFERENT requests approved at once both land: neither write loses the other (file store)", async () => {
  const a = await beginCliLogin("laptop-a");
  const b = await beginCliLogin("laptop-b");
  const outcomes = await Promise.all([decideCliLogin(a.code, "approve", person), decideCliLogin(b.code, "approve", person)]);
  assert.deepEqual(outcomes, ["approved", "approved"]);
  assert.equal((await pollCliLogin(a.id)).status, "approved", "a was not written back to approving by b");
  assert.equal((await pollCliLogin(b.id)).status, "approved");
});
