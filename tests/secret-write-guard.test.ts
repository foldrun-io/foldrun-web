// Every route that writes a vault secret asks server/secret-writes.ts first,
// so a rule on secrets holds on every way in. The rule tested here: only the
// account's owner sets the account's mail sender (RESEND_API_KEY, EMAIL_FROM)
// — it carries everyone's reset links. On 30 Oct 2026 it was kept by
// PUT /api/secrets alone, and an admin set it through an OAuth connect, or
// through PUT with the name sent as a list. And a workspace-scoped admin may
// not rewrite the account's saved OAuth apps through an oauth2 recipe.
//
//   node --import ./tests/register.mjs --test tests/secret-write-guard.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-secret-guard-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_RESEND_API_KEY;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { createUser } = await import("../server/users.ts");
const { listSecrets } = await import("../../foldrun-core/src/secrets.ts");
const { saveOAuthClient, getOAuthClient } = await import("../../foldrun-platform/src/oauth-clients.ts");
const secretsRoute = await import("../app/api/secrets/route.ts");
const startRoute = await import("../app/api/oauth/start/route.ts");
const reconnectRoute = await import("../app/api/oauth/reconnect/route.ts");

await createUser("owner@acme.test", "correct horse battery staple 9", "acme");
fs.mkdirSync(path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", "desk"), { recursive: true });
// The owner's own `foldrun login` key acts as the owner; a key the owner
// minted for anything else (CI, a contractor) does not (30 Oct 2026).
const { key: ownerKey } = await createApiKey("acme", "cli · owner's laptop", "owner@acme.test", undefined, "admin", null, { origin: "cli-login" });
const { key: ownerCiKey } = await createApiKey("acme", "ci", "owner@acme.test", undefined, "admin");
const { key: admin } = await createApiKey("acme", "ops", "admin@acme.test", undefined, "admin");
const { key: scoped } = await createApiKey("acme", "desk ops", "desk@acme.test", undefined, "admin", ["desk"]);

const call = (key: string, url: string, method: string, body: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const accountNames = () => listSecrets("acme").filter((s) => s.scope === "account").map((s) => s.name);

test("a secret's name is a string: a list that prints as RESEND_API_KEY is refused, not stored", async () => {
  for (const name of [["RESEND_API_KEY"], ["EMAIL_FROM"]]) {
    const res = await secretsRoute.PUT(call(admin, "/api/secrets", "PUT", { name, value: "re_attacker" }));
    assert.equal(res.status, 400, JSON.stringify(name));
  }
  const patch = await secretsRoute.PATCH(call(admin, "/api/secrets", "PATCH", { name: ["RESEND_API_KEY"], sites: [] }));
  assert.equal(patch.status, 400);
  assert.deepEqual(accountNames(), []);
});

test("only the owner sets, rebinds or removes the account's mail sender — through PUT, PATCH and DELETE alike", async () => {
  const refused = await secretsRoute.PUT(call(admin, "/api/secrets", "PUT", { name: "RESEND_API_KEY", value: "re_attacker" }));
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /only the account's owner/);
  assert.equal((await secretsRoute.PUT(call(ownerKey, "/api/secrets", "PUT", { name: "RESEND_API_KEY", value: "re_owner" }))).status, 200);
  assert.equal((await secretsRoute.PATCH(call(admin, "/api/secrets", "PATCH", { name: "RESEND_API_KEY", sites: ["api.resend.com"] }))).status, 403);
  assert.equal((await secretsRoute.DELETE(call(admin, "/api/secrets", "DELETE", { name: "RESEND_API_KEY" }))).status, 403);
  assert.deepEqual(accountNames(), ["RESEND_API_KEY"]);
  // In a workspace it is any other secret's name.
  assert.equal((await secretsRoute.PUT(call(admin, "/api/secrets", "PUT", { name: "RESEND_API_KEY", value: "re_desk", workspace: "desk" }))).status, 200);
});

test("an OAuth connect or reconnect may not name the account's mail sender either", async () => {
  for (const secret of ["RESEND_API_KEY", "EMAIL_FROM"]) {
    const start = await startRoute.POST(call(admin, "/api/oauth/start", "POST", { client: "mine", secret }));
    assert.equal(start.status, 403, `start ${secret}`);
    const again = await reconnectRoute.POST(call(admin, "/api/oauth/reconnect", "POST", { secret, provider: "mine" }));
    assert.equal(again.status, 403, `reconnect ${secret}`);
  }
  // A list for the name is refused there too.
  assert.equal((await startRoute.POST(call(admin, "/api/oauth/start", "POST", { client: "mine", secret: ["RESEND_API_KEY"] }))).status, 400);
  // The guard is what refused: past it, the same call is only missing its client.
  assert.equal((await startRoute.POST(call(admin, "/api/oauth/start", "POST", { client: "mine", secret: "RESEND_API_KEY", workspace: "desk" }))).status, 404);
});

test("a workspace-scoped admin's oauth2 recipe does not rewrite the account's saved OAuth app", async () => {
  const google = { authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", token_url: "https://oauth2.googleapis.com/token", client_id: "acct-cid", client_secret: "acct-sec", scopes: "mail" };
  await saveOAuthClient("acme", "google", google);
  const before = await getOAuthClient("acme", "google");
  const res = await secretsRoute.PUT(call(scoped, "/api/secrets", "PUT", {
    name: "GMAIL",
    workspace: "desk",
    oauth2: { token_url: google.token_url, client_id: "acct-cid", client_secret: "junk", refresh_token: "rt", authorize_url: "https://evil.example/authorize" },
  }));
  assert.equal(res.status, 200, "the workspace's own secret is still written");
  assert.deepEqual(await getOAuthClient("acme", "google"), before);
});

test("only the owner in person sets the mail sender: their session or their own `foldrun login` key, never another key they minted", async () => {
  const { actsForOwner } = await import("../server/secret-writes.ts");
  const ci = await secretsRoute.PUT(call(ownerCiKey, "/api/secrets", "PUT", { name: "EMAIL_FROM", value: "ci@acme.test" }));
  assert.equal(ci.status, 403, "an admin CI key the owner minted is not the owner");
  assert.equal((await secretsRoute.PUT(call(ownerKey, "/api/secrets", "PUT", { name: "EMAIL_FROM", value: "owner@acme.test" }))).status, 200);
  // The rule itself, for every kind of caller.
  assert.equal(await actsForOwner("acme", { kind: "user", id: "u1", name: "owner@acme.test", role: "owner" }), true);
  assert.equal(await actsForOwner("acme", { kind: "user", id: "u1", name: "support:ops@foldrun.io", role: "owner", readOnly: true }), false, "a support view acts for no one");
  assert.equal(await actsForOwner("acme", { kind: "user", id: "u2", name: "admin@acme.test", role: "admin" }), false);
  assert.equal(await actsForOwner("acme", { kind: "key", id: "k1", name: "owner@acme.test", role: "admin" }), false, "a key with no origin");
  assert.equal(await actsForOwner("acme", { kind: "key", id: "k2", name: "owner@acme.test", role: "admin", origin: "cli-login" }), true);
  assert.equal(await actsForOwner("acme", { kind: "key", id: "k3", name: "admin@acme.test", role: "admin", origin: "cli-login" }), false, "an admin's own CLI is not the owner's");
});
