// One login, several accounts, in Postgres (FOL-464): the membership rows,
// a session bound to its account's row, removal and the first account moving.
// The rules themselves are tests/one-login-several-accounts.test.ts.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://… node --import ./tests/register.mjs --test tests/one-login-several-accounts-db.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-several-db-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

const PW = "a long and unusual passphrase 42!";

test("memberships in Postgres: join, a session per account, a race, removal, and the first account moving", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { orm, memberships, users, eq } = await import("@/platform/orm.ts");
  const U = await import("../server/users.ts");
  const n = Date.now();
  const A = `sa${n}`, B = `sb${n}`;
  const ana = await U.createUser(`ana@${A}.test`, PW, A, { request: "free" });
  const bo = await U.createUser(`bo@${B}.test`, PW, B, { request: "free" });
  await U.setEmailVerified(ana.id);
  const rows = async () => orm()!.select().from(memberships).where(eq(memberships.userId, ana.id));
  const invite = async (role: "viewer" | "editor" | "admin", workspaces: string[] | null = null) => (await U.mintInvite(B, role, { email: ana.email, workspaces, by: { id: bo.id, email: bo.email } })).token;

  // Five joins of one link at once: one membership.
  const token = await invite("viewer", ["desk"]);
  const tries = await Promise.allSettled([1, 2, 3, 4, 5].map(() => U.joinAccount(token, ana.id)));
  assert.equal(tries.filter((t) => t.status === "fulfilled").length, 1);
  const [m] = await rows();
  assert.equal((await rows()).length, 1);
  assert.equal(m.tenant, B);
  assert.equal(m.role, "viewer");
  assert.equal(m.owner, false);
  assert.deepEqual(m.workspaces, ["desk"]);
  assert.equal((await orm()!.select().from(users).where(eq(users.id, ana.id)))[0].tenant, A, "the person's row is untouched");

  assert.equal(await U.roleOfUser(B, ana.id), "viewer");
  assert.equal(await U.roleOfUser(A, ana.id), "owner");
  assert.deepEqual(await U.allowedWorkspaces(B, ana.id), ["desk"]);

  // A session is its account's: the row names it, and verifySession reads the member there.
  const inB = (await U.findMember(B, { id: ana.id }))!;
  const sB = (await U.mintSession(inB)).value;
  const sA = (await U.mintSession((await U.findMember(A, { id: ana.id }))!)).value;
  const vB = await U.verifySession(sB);
  assert.equal(vB?.tenant, B);
  assert.equal(vB?.role, "viewer");
  assert.equal(vB?.owner, undefined);
  assert.equal((await U.verifySession(sA))?.tenant, A);
  assert.equal((await U.verifySession(sA))?.owner, true);

  // A role change there is that row's.
  await U.setMemberRole(B, ana.id, "editor", bo.id);
  assert.equal((await rows())[0].role, "editor");
  assert.equal((await orm()!.select().from(users).where(eq(users.id, ana.id)))[0].role, null);

  // Removed from B: the row goes, B's session is nobody's, A's lives.
  assert.ok(await U.removeMember(B, ana.id, bo.id));
  assert.equal((await rows()).length, 0);
  assert.equal(await U.verifySession(sB), null);
  assert.equal((await U.verifySession(sA))?.tenant, A);

  // Let back in: the session from before they left stays dead.
  await U.joinAccount(await invite("viewer"), ana.id);
  assert.equal(await U.verifySession(sB), null);
  assert.match((await U.mintSession((await U.findMember(B, { id: ana.id }))!)).value, /^v3\./);
  assert.ok(await U.removeMember(B, ana.id, bo.id));

  // Removed from the first account while in another: the person's row moves to the other.
  await U.joinAccount(await invite("viewer"), ana.id);
  const cy = (await U.acceptInvite((await U.mintInvite(A, "admin", { email: `cy@${A}.test`, by: { id: ana.id, email: ana.email } })).token, `cy@${A}.test`, PW)).user;
  await U.transferOwnership(A, cy.id, ana.id);
  assert.ok(await U.removeMember(A, ana.id, cy.id));
  const person = (await orm()!.select().from(users).where(eq(users.id, ana.id)))[0];
  assert.equal(person.tenant, B);
  assert.equal(person.owner, false);
  assert.equal(person.role, "viewer");
  assert.equal((await rows()).length, 0, "it is their first account now, not a joined one");
  assert.equal(await U.verifySession(sA), null);
  assert.equal((await U.verifyPassword(ana.email, PW))?.tenant, B);
  // B has no marked owner here? It has: bo. Take the mark away, as on an
  // account from before owners were marked: the earliest member owns it, and
  // that is still bo, because ana's row is now dated when she joined B.
  await orm()!.update(users).set({ owner: false }).where(eq(users.id, bo.id));
  assert.equal((await U.ownerOf(B))?.id, bo.id, "who came late never reads as the founder");
  assert.ok(person.createdAt.getTime() > Date.parse(bo.createdAt));
});
