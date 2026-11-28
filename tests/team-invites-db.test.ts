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
  const owner = await createUser(`owner@${tenant}.test`, PW, tenant, { request: "free" });
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

test("invites in Postgres, the invited side (FOL-464): waiting invites by address, decline, join by id under a race, the mailed link confirming, expiry told once", opts, async () => {
  process.env.FOLDRUN_RESEND_API_KEY = "re_test";
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { orm, invites, eq, sql } = await import("@/platform/orm.ts");
  const { createUser, setEmailVerified, mintInvite, acceptInvite, invitesFor, declineInvite, joinById, claimExpiredInvites, listInvites, accountsOf, findUser } = await import("../server/users.ts");
  const { deleteTenant } = await import("@/platform/tenant-delete.ts");
  const stamp = Date.now();
  const tenant = `ans${stamp}`;
  const home = `home${stamp}`;
  const owner = await createUser(`owner@${tenant}.test`, PW, tenant, { request: "free" });
  const ana = await createUser(`Ana@${home}.test`, PW, home, { request: "free" });
  await setEmailVerified(owner.id);
  const by = { id: owner.id, email: owner.email };
  const row = async (id: string) => (await orm()!.select().from(invites).where(eq(invites.id, id)))[0];

  // Nothing waits on an address that is not confirmed; then it does, found whatever the case it was typed in.
  const first = await mintInvite(tenant, "viewer", { email: `ana@${home}.test`, by });
  assert.deepEqual(await invitesFor(ana.id), []);
  await setEmailVerified(ana.id);
  assert.deepEqual((await invitesFor(ana.id)).map((i) => [i.id, i.account, i.role]), [[first.id, tenant, "viewer"]]);

  // Decline: not by someone else, once, and it reads "declined".
  await assert.rejects(() => declineInvite(first.id, owner.id), /no longer valid/);
  assert.equal((await declineInvite(first.id, ana.id)).revokeReason, "declined");
  await assert.rejects(() => declineInvite(first.id, ana.id), /no longer valid/);
  await assert.rejects(() => joinById(first.id, ana.id), /no longer valid/);
  assert.equal((await listInvites(tenant, { all: true, scope: null })).find((i) => i.id === first.id)?.status, "declined");
  assert.deepEqual(await invitesFor(ana.id), []);

  // Join by id, five at once: one membership.
  const second = await mintInvite(tenant, "editor", { email: `ana@${home}.test`, by });
  const joins = await Promise.allSettled([1, 2, 3, 4, 5].map(() => joinById(second.id, ana.id)));
  assert.equal(joins.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(joins.map((r) => r.status)));
  assert.deepEqual((await accountsOf(ana.id)).map((a) => [a.tenant, a.role]), [[home, "owner"], [tenant, "editor"]]);
  // An open link has no id door: its link is its one secret.
  const open = await mintInvite(tenant, "viewer", { by });
  await assert.rejects(() => joinById(open.id, ana.id), /no longer valid/);

  // The mailed link confirms the address in the row it creates; the copy link does not.
  const m = await mintInvite(tenant, "viewer", { email: `mailed@${tenant}.test`, by });
  assert.equal((await acceptInvite(m.mailToken, `mailed@${tenant}.test`, PW)).mailed, true);
  assert.ok((await findUser(`mailed@${tenant}.test`))?.emailVerifiedAt);
  const c = await mintInvite(tenant, "viewer", { email: `copied@${tenant}.test`, by });
  assert.equal((await acceptInvite(c.token, `copied@${tenant}.test`, PW)).mailed, false);
  assert.equal((await findUser(`copied@${tenant}.test`))?.emailVerifiedAt ?? null, null);

  // Ran out unused: handed out once, and not one that ended long ago.
  const slow = await mintInvite(tenant, "viewer", { email: `slow@${tenant}.test`, by });
  const old = await mintInvite(tenant, "viewer", { email: `old@${tenant}.test`, by });
  await orm()!.update(invites).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(invites.id, slow.id));
  await orm()!.update(invites).set({ expiresAt: sql`now() - interval '30 days'` }).where(eq(invites.id, old.id));
  const [one, two] = await Promise.all([claimExpiredInvites(), claimExpiredInvites()]);
  assert.deepEqual([...one, ...two].filter((r) => r.tenant === tenant).map((r) => r.id), [slow.id]);
  assert.ok((await row(slow.id)).noticedAt);
  assert.equal((await row(old.id)).noticedAt, null);

  // A session made for the operator console is no dashboard sign-in: it
  // neither reads nor answers the person's invites.
  const { SESSION_COOKIE, mintSession } = await import("../server/users.ts");
  const { NextRequest } = await import("next/server");
  const mineRoute = await import("../app/v1/me/invites/route.ts");
  const consoleSession = await mintSession(ana, null, { audience: "console" });
  const viaConsole = await mineRoute.GET(new NextRequest("http://localhost:3900/v1/me/invites", { headers: { cookie: `${SESSION_COOKIE}=${consoleSession.value}`, origin: "http://localhost:3900" } }));
  assert.ok([401, 403].includes(viaConsole.status), String(viaConsole.status));
  const dashboard = await mintSession(ana, null, {});
  const viaDashboard = await mineRoute.GET(new NextRequest("http://localhost:3900/v1/me/invites", { headers: { cookie: `${SESSION_COOKIE}=${dashboard.value}`, origin: "http://localhost:3900" } }));
  assert.equal(viaDashboard.status, 200);
  // Nor copies or resends the team's invites, even as an admin of it.
  const ownerConsole = await mintSession(owner, null, { audience: "console" });
  const pend = await mintInvite(tenant, "viewer", { email: `pend@${tenant}.test`, by });
  for (const verb of ["link", "resend"] as const) {
    const route = await import(`../app/v1/team/invites/[id]/${verb}/route.ts`);
    const post = (cookie: string) => route.POST(new NextRequest(`http://localhost:3900/v1/team/invites/${pend.id}/${verb}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${cookie}`, origin: "http://localhost:3900" } }), { params: Promise.resolve({ id: pend.id }) });
    const refused = await post(ownerConsole.value);
    assert.ok([401, 403].includes(refused.status), `${verb}: ${refused.status}`);
  }
  const ownerDash = await mintSession(owner, null, {});
  const linkRoute = await import("../app/v1/team/invites/[id]/link/route.ts");
  const ok = await linkRoute.POST(new NextRequest(`http://localhost:3900/v1/team/invites/${pend.id}/link`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${ownerDash.value}`, origin: "http://localhost:3900" } }), { params: Promise.resolve({ id: pend.id }) });
  assert.equal(ok.status, 200, await ok.clone().text());

  await deleteTenant(tenant, { confirm: tenant, by: "test" });
  await deleteTenant(home, { confirm: home, by: "test" });
});
