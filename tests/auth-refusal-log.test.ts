// A refused caller is recorded on its account (D239 phase 1): the operator
// console's timeline answers "my key stopped working" from these lines.
// Once per request, with the account and the key's id when the key was
// found, and never the key itself.
//
//   node --import ./tests/register.mjs --test tests/auth-refusal-log.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-refusal-log-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_SECRET_KEY = "refusal-log-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const { NextRequest } = await import("next/server");
const { createApiKey, revokeApiKey, resolveTenant } = await import("../server/auth.ts");
const { requirePermission } = await import("../server/api.ts");
const { createUser, findUser } = await import("../server/users.ts");
const login = await import("../app/api/auth/login/route.ts");

function capture(): { lines: string[]; done: () => void } {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(String(a[0]));
  return { lines, done: () => void (console.warn = warn) };
}
const req = (key: string) => new NextRequest("https://app.example.test/api/workspaces/desk/runs", { headers: { authorization: `Bearer ${key}` } });

test("a revoked key is recorded once per request, on its account, by the key's id — never the key", async () => {
  const { key, record } = await createApiKey("acme", "ci", undefined, undefined, "editor");
  await revokeApiKey("acme", record.id);
  const c = capture();
  try {
    const r = req(key);
    assert.equal((await resolveTenant(r)).tenant, null);
    assert.equal((await resolveTenant(r)).tenant, null, "a second look in the same request");
    await resolveTenant(req("fr_api_nosuchkey000000000000"));
  } finally {
    c.done();
  }
  const refused = c.lines.filter((l) => l.startsWith("[ops] auth.refused"));
  assert.equal(refused.length, 2, refused.join("\n"));
  assert.match(refused[0]!, /reason=key_revoked/);
  assert.match(refused[0]!, /tenant=acme/);
  assert.ok(refused[0]!.includes(`key=${record.id}`));
  assert.match(refused[1]!, /reason=key_unknown/);
  assert.doesNotMatch(refused[1]!, /tenant=/);
  assert.ok(refused.every((l) => !l.includes(key) && !l.includes("fr_api_nosuch")), "never the key itself");
});

test("a key let in but short of the role is recorded as api.refused with its id", async () => {
  const { key, record } = await createApiKey("acme", "viewer key", undefined, undefined, "viewer");
  const c = capture();
  try {
    await assert.rejects(requirePermission(req(key), "keys:manage"), (e: { status: number }) => e.status === 403);
  } finally {
    c.done();
  }
  const line = c.lines.find((l) => l.startsWith("[ops] api.refused"));
  assert.ok(line, c.lines.join("\n"));
  assert.match(line!, /reason=role_too_low/);
  assert.match(line!, /tenant=acme/);
  assert.ok(line!.includes(`key=${record.id}`));
});

test("a refused sign-in is recorded against the member and account, never the address; an unknown address has neither", async () => {
  await createUser("ana@refusal.test", "a long enough password 1", "refusal-ana", { request: "free" });
  const ana = (await findUser("ana@refusal.test"))!;
  const c = capture();
  try {
    const signIn = (email: string) =>
      login.POST(new NextRequest("http://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong" }) }));
    assert.equal((await signIn("ana@refusal.test")).status, 401);
    assert.equal((await signIn("nobody@refusal.test")).status, 401);
    // The note is written off the answer's path (timing): let it land.
    for (let i = 0; i < 50 && c.lines.filter((l) => l.startsWith("[ops] auth.refused")).length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  } finally {
    c.done();
  }
  const refused = c.lines.filter((l) => l.startsWith("[ops] auth.refused surface=login") || (l.startsWith("[ops] auth.refused") && l.includes("surface=login")));
  assert.equal(refused.length, 2, c.lines.join("\n"));
  const mine = refused.find((l) => l.includes(`user=${ana.id}`));
  assert.ok(mine && mine.includes(`tenant=${ana.tenant}`) && /reason=bad_credentials/.test(mine), refused.join("\n"));
  assert.ok(refused.some((l) => !/tenant=/.test(l) && !/user=/.test(l)), "an address that is no member's: no ids");
  assert.ok(refused.every((l) => !l.includes("@")), "never the address");
});
