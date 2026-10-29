// Team invites against Postgres (29 Oct 2026): the `invites` table, used up
// by one UPDATE … WHERE used_at IS NULL in the transaction that creates the
// member. Two acceptances racing make one member; a refusal inside that
// transaction leaves the row unused; deleting the account deletes its rows.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres \
//     node --import ./tests/register.mjs --test tests/team-invites-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-team-invites-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

const PW = "a long and unusual passphrase 42!";

test("invites in Postgres: one member per link under a race, a refused accept rolls back, deleting the account deletes its invites", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { orm, invites, eq } = await import("@/platform/orm.ts");
  const { createUser, mintInvite, acceptInvite, peekInvite, revokeInvitesBeyond, listMembers } = await import("../server/users.ts");
  const { deleteTenant } = await import("@/platform/tenant-delete.ts");
  const tenant = `inv${Date.now()}`;
  const owner = await createUser(`owner@${tenant}.test`, PW, tenant);
  const row = async (id: string) => (await orm()!.select().from(invites).where(eq(invites.id, id)))[0];

  // A race: five acceptances of one link, one member.
  const open = await mintInvite(tenant, "viewer", { by: { id: owner.id, email: owner.email } });
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => acceptInvite(open.token, `race${i}@${tenant}.test`, PW)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status)));
  const used = await row(open.id);
  assert.ok(used.usedAt, "used");
  assert.equal((await listMembers(tenant)).length, 2);
  assert.equal(await peekInvite(open.token), null);

  // A refusal inside the transaction (the wrong address) rolls the claim back.
  const bound = await mintInvite(tenant, "editor", { email: `right@${tenant}.test`, workspaces: null, by: { id: owner.id, email: owner.email } });
  await assert.rejects(() => acceptInvite(bound.token, `wrong@${tenant}.test`, PW), /this invite was sent to/);
  assert.equal((await row(bound.id)).usedAt, null, "still unused after a refused accept");
  // As does a taken address on a link with none.
  const anyone = await mintInvite(tenant, "viewer", { by: { id: owner.id, email: owner.email } });
  await assert.rejects(() => acceptInvite(anyone.token, owner.email, PW), /already exists/);
  assert.equal((await row(anyone.id)).usedAt, null);
  const ok = await acceptInvite(bound.token, `right@${tenant}.test`, PW);
  assert.equal(ok.user.role, "editor");
  assert.equal((await row(bound.id)).usedBy, ok.user.id);

  // A newer invite to an address supersedes the older one, in the table.
  const a1 = await mintInvite(tenant, "viewer", { email: `again@${tenant}.test`, by: { id: owner.id, email: owner.email } });
  const a2 = await mintInvite(tenant, "viewer", { email: `again@${tenant}.test`, by: { id: owner.id, email: owner.email } });
  assert.deepEqual(a2.superseded, [a1.id]);
  assert.ok((await row(a1.id)).revokedAt);
  // And a removed maker's go with them.
  const gone = await revokeInvitesBeyond(tenant, { id: owner.id, email: owner.email }, null, "test");
  assert.ok(gone.includes(a2.id) && gone.includes(anyone.id));

  // Deleting the account deletes its rows.
  const report = await deleteTenant(tenant, { confirm: tenant, by: "test" });
  assert.ok(report.invitesRemoved >= 4, String(report.invitesRemoved));
  assert.equal((await orm()!.select().from(invites).where(eq(invites.tenant, tenant))).length, 0);
});
