// FOL-71: a `foldrun login` key no longer lives forever.
//
// It is minted for CLI_KEY_DAYS and marked `origin: "cli-login"`; it may
// rotate ITSELF whatever its role (the CLI renews it with under 14 days
// left), keeping its label, role, workspaces and lifetime; no other key may
// rotate itself or another without keys:manage; the week's-notice expiry
// mail skips it; and once it has ended, the 401 says to sign in again.
// The file store here; the column and the sweep's query are Postgres
// (foldrun-platform drizzle/0027, api-keys-db.ts).
//
//   node --import ./tests/register.mjs --test tests/cli-key-lifetime.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-key-life-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { NextRequest } = await import("next/server");
const { beginCliLogin, decideCliLogin, pollCliLogin } = await import("../server/cli-login.ts");
const { listApiKeys, createApiKey, expiringKeys, resolveTenant, CLI_KEY_DAYS } = await import("../server/auth.ts");
const rotate = (await import("../app/api/keys/[id]/rotate/route.ts")) as {
  POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};
const meRoute = (await import("../app/api/me/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };

const DAY = 86_400_000;
const viewer = { tenant: "acme", email: "viewer@acme.test", role: "viewer" as const, workspaces: ["blog"] };

/** Sign a machine in the way `foldrun login` does, as a viewer. */
async function signIn(host: string) {
  const req = await beginCliLogin(host);
  assert.equal(await decideCliLogin(req.code, "approve", viewer), "approved");
  const got = (await pollCliLogin(req.id)) as { status: string; grant: { key: string } };
  const record = (await listApiKeys("acme")).find((k) => k.label === `cli · ${host}` && !k.revokedAt)!;
  return { token: got.grant.key, record };
}

const post = (id: string, token: string) =>
  rotate.POST(
    new NextRequest(`http://localhost/api/keys/${id}/rotate`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" }),
    { params: Promise.resolve({ id }) },
  );

test("a login key is minted for 90 days and marked as one", async () => {
  const { record } = await signIn("mbp");
  assert.equal(record.origin, "cli-login");
  const life = Date.parse(record.expiresAt!) - Date.parse(record.createdAt);
  assert.ok(Math.abs(life - CLI_KEY_DAYS * DAY) < 60_000, `lives ${CLI_KEY_DAYS} days, not forever (${record.expiresAt})`);
  const me = await (await meRoute.GET(new NextRequest("http://localhost/api/me", { headers: { authorization: `Bearer ${(await signIn("mbp-me")).token}` } }))).json();
  assert.equal(me.actor.origin, "cli-login", "/api/me says so, for the CLI");
  assert.ok(me.actor.expiresAt);
});

test("a viewer's login key rotates itself: same label, role, scope and lifetime; the old one ends shortly after", async () => {
  const { token, record } = await signIn("desk");
  const res = await post(record.id, token);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.match(body.key, /^mda_/);
  const keys = await listApiKeys("acme");
  const fresh = keys.find((k) => k.id === body.id)!;
  assert.equal(fresh.label, "cli · desk");
  assert.equal(fresh.role, "viewer");
  assert.deepEqual(fresh.workspaces, ["blog"]);
  assert.equal(fresh.origin, "cli-login", "the new key renews itself too");
  assert.ok(Math.abs(Date.parse(fresh.expiresAt!) - Date.now() - CLI_KEY_DAYS * DAY) < 60_000);
  const old = keys.find((k) => k.id === record.id)!;
  assert.equal(old.replacedBy, body.id);
  const endsIn = Date.parse(old.expiresAt!) - Date.now();
  assert.ok(endsIn > 0 && endsIn <= 10 * 60_000, "a short grace, in case the new key was not saved");
  assert.equal((await resolveTenant(new NextRequest("http://localhost/api/me", { headers: { authorization: `Bearer ${body.key}` } }))).tenant, "acme");
});

test("a login key may not rotate another key, and a key a person minted may not rotate itself", async () => {
  const a = await signIn("a");
  const b = await signIn("b");
  assert.equal((await post(b.record.id, a.token)).status, 403, "another's key needs keys:manage (a viewer has none)");
  const { key, record } = await createApiKey("acme", "ci", "viewer@acme.test", undefined, "viewer", null, { expiresAt: new Date(Date.now() + 30 * DAY) });
  assert.equal((await post(record.id, key)).status, 403, "a CI key keeps the end its owner chose");
  const still = (await listApiKeys("acme")).find((k) => k.id === record.id)!;
  assert.equal(still.replacedBy ?? null, null);
});

test("the week's-notice expiry mail skips login keys; their end, once reached, says to sign in again", async () => {
  const soon = new Date(Date.now() + 8 * DAY);
  const { record: own } = await createApiKey("acme", "deploy", "owner@acme.test", undefined, "editor", null, { expiresAt: new Date(Date.now() + 3 * DAY) });
  const { key, record: cli } = await createApiKey("acme", "cli · old", "owner@acme.test", undefined, "editor", null, { expiresAt: new Date(Date.now() + 3 * DAY), origin: "cli-login" });
  const due = (await expiringKeys(soon)).map((k) => k.id);
  assert.ok(due.includes(own.id), "a person's key is still warned about");
  assert.ok(!due.includes(cli.id), "a login key is renewed, not mailed about");

  const file = path.join(process.env.FOLDRUN_DATA!, "keys.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all.find((k: { id: string }) => k.id === cli.id).expiresAt = new Date(Date.now() - DAY).toISOString();
  fs.writeFileSync(file, JSON.stringify(all));
  const ended = await resolveTenant(new NextRequest("http://localhost/api/me", { headers: { authorization: `Bearer ${key}` } }));
  assert.equal(ended.tenant, null);
  assert.match((ended as { message?: string }).message ?? "", /sign-in ended on .* run `foldrun login`/);
});
