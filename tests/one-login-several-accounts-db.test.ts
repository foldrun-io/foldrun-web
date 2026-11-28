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
process.env.FOLDRUN_RESEND_API_KEY = "re_test"; // the install sends its own sign-in mail (joinAccount asks)
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
  await U.setEmailVerified(bo.id);
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

  // Moving a session (POST /v1/auth/session): the old row is spent, the new
  // one ends when the old would have, and a spent session moves nowhere.
  {
    const { NextRequest } = await import("next/server");
    const route = await import("../app/v1/auth/session/route.ts");
    const { sessions } = await import("@/platform/orm.ts");
    const start = (await U.mintSession(ana, null, { mfa: true })).value;
    const rowOf = async (cookie: string) => (await orm()!.select().from(sessions).where(eq(sessions.id, cookie.split(".")[1])))[0];
    const before = await rowOf(start);
    await new Promise((r) => setTimeout(r, 20));
    const move = (cookie: string, account: string) =>
      route.POST(new NextRequest("http://localhost:3900/v1/auth/session", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3900", cookie: `${U.SESSION_COOKIE}=${cookie}` }, body: JSON.stringify({ account }) }));
    const [one, two] = await Promise.all([move(start, B), move(start, B)]);
    assert.deepEqual([one.status, two.status].sort(), [200, 401], "of two moves at once, one");
    const moved = /foldrun_session=([^;]+)/.exec((one.status === 200 ? one : two).headers.get("set-cookie") ?? "")![1];
    assert.equal(await U.verifySession(start), null, "the old session is spent");
    assert.equal((await U.verifySession(moved))?.tenant, B);
    const after = await rowOf(moved);
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime(), "moving renews nothing");
    assert.equal(after.mfaAt?.getTime(), before.mfaAt?.getTime(), "the second factor is as old as it was");
    assert.equal(after.membershipId, m.id);
    assert.equal((await move(start, A)).status, 401, "a spent session moves nowhere");
  }

  // Removed from B: the row goes, B's session is nobody's, A's lives.
  assert.ok(await U.removeMember(B, ana.id, bo.id));
  assert.equal((await rows()).length, 0);
  assert.equal(await U.verifySession(sB), null);
  assert.equal((await U.verifySession(sA))?.tenant, A);

  // Let back in: the session from before they left stays dead.
  const second = (await U.joinAccount(await invite("viewer"), ana.id)).user;
  assert.equal(await U.verifySession(sB), null);
  assert.match((await U.mintSession((await U.findMember(B, { id: ana.id }))!)).value, /^v3\./);
  // A sign-in that read them during the stay and wrote its row after the
  // removal's sweep: the row names that stay, and the next stay is another.
  assert.ok(await U.removeMember(B, ana.id, bo.id));
  const late = (await U.mintSession(second)).value;
  assert.equal(await U.verifySession(late), null, "out of the account");
  await U.joinAccount(await invite("viewer"), ana.id);
  assert.equal(await U.verifySession(late), null, "and not back with them");
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

test("a session's move in Postgres: refused, it stays where it was; raced with 'sign out other devices', it is ended", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const U = await import("../server/users.ts");
  const n = Date.now();
  const A = `ma${n}`, B = `mb${n}`;
  const ana = await U.createUser(`ana@${A}.test`, PW, A, { request: "free" });
  const bo = await U.createUser(`bo@${B}.test`, PW, B, { request: "free" });
  await U.setEmailVerified(ana.id);
  await U.setEmailVerified(bo.id);
  const sign = async () => (await U.mintSession((await U.findMember(A, { id: ana.id }))!)).value;

  // Refused after the old session's row was spent (an account they are not
  // in): the spend rolls back with the rest, and the session still works.
  const first = await sign();
  await assert.rejects(U.moveSession((await U.verifySession(first))!, { account: B }, null));
  assert.equal((await U.verifySession(first))?.tenant, A, "a refused move leaves the session where it was");
  // The same for an invite that is not theirs.
  const others = (await U.mintInvite(B, "viewer", { email: `else@${B}.test`, by: { id: bo.id, email: bo.email } })).token;
  await assert.rejects(U.moveSession((await U.verifySession(first))!, { invite: others }, null));
  assert.equal((await U.verifySession(first))?.tenant, A);

  // In B now, and two devices: one moves while the other signs every other
  // device out. Whichever write is first, the mover holds no live session:
  // the sweep takes the new row, or the move finds its old row spent.
  await U.joinAccount((await U.mintInvite(B, "viewer", { email: ana.email, by: { id: bo.id, email: bo.email } })).token, ana.id);
  for (let i = 0; i < 6; i++) {
    const keeper = (await U.verifySession(await sign()))!;
    const moverCookie = await sign();
    const mover = (await U.verifySession(moverCookie))!;
    const [moved] = await Promise.allSettled([U.moveSession(mover, { account: B }, null), U.endSessions(ana.id, keeper.session!.id!)]);
    assert.equal(await U.verifySession(moverCookie), null, "the session it moved from is over either way");
    if (moved.status === "fulfilled") assert.equal(await U.verifySession(moved.value.session.value), null, "and the one it moved to was another device's: ended");
  }
});
