// One key (22 Nov 2026): an API key that may also call foldrun's models.
// Made at `foldrun login` with the person's yes, or by an admin of every
// workspace with POST /v1/keys { modelAccess }. The platform API reads its
// role and workspaces as ever; the gateway reads its model grant. Every
// other kind of key keeps exactly its old reach.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/unified-key-db.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-unified-key-db-"));
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_GATEWAY_URL = "https://api.example.test/";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("one key: issued with model access, it opens the API at its role and the gateway within its grant; rotation keeps both", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey, rotateApiKey, listApiKeys, resolveTenant, revokeApiKey } = await import("../server/auth.ts");
  const door = await import("@/platform/gateway-door.ts");
  const { findApiKeyByHashDb } = await import("@/platform/api-keys-db.ts");
  // The real table, without the LISTEN the door opens in production.
  door.setGatewayKeyLookupForTests((h) => findApiKeyByHashDb(h));
  door.setGatewayTouchForTests(async () => {});
  const tenant = `one${Date.now()}`;
  const keysRoute = (await import("../app/v1/keys/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>) => Promise<Response>; GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const { key: admin } = await createApiKey(tenant, "admin", undefined, undefined, "admin");
  const post = async (bearer: string, body: object) => {
    const r = await keysRoute.POST(new NextRequest("https://app.example.test/v1/keys", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, body: (await r.json()) as Json };
  };
  const gate = (key: string) => door.authenticate({ authorization: `Bearer ${key}` });
  try {
    // A CI key: one secret for the platform API and the model routes.
    const ci = await post(admin, { label: "ci", role: "editor", modelAccess: { dailyUsd: 50, walletUsd: 5 } });
    assert.equal(ci.status, 200, JSON.stringify(ci.body));
    assert.match(ci.body.key, /^fr_api_/, "still an API key, by its prefix");
    assert.deepEqual(ci.body.modelAccess, { capUsd: null, dailyUsd: 50, walletUsd: 5 });
    assert.equal(ci.body.gatewayUrl, "https://api.example.test");
    const row = (await listApiKeys(tenant)).find((k) => k.id === ci.body.id)!;
    assert.equal(row.purpose, undefined);
    assert.deepEqual(row.gateway, { capUsd: null, dailyUsd: 50, credential: "account", walletUsd: 5, principal: ci.body.id });
    const api = await resolveTenant(new NextRequest("https://app.example.test/v1/workspaces", { headers: { authorization: `Bearer ${ci.body.key}` } }));
    assert.equal(api.tenant, tenant, "the platform API takes it");
    if (api.tenant !== null) assert.equal(api.actor.role, "editor", "at its own role, never more for having model access");
    const g = await gate(ci.body.key);
    assert.ok("who" in g, JSON.stringify(g));
    if ("who" in g) assert.equal(g.who.grant.dailyUsd, 50);

    // The list shows its spend like a gateway key's.
    const list = (await (await keysRoute.GET(new NextRequest("https://app.example.test/v1/keys", { headers: { authorization: `Bearer ${admin}` } }))).json()) as { keys: { id: string; gateway?: Json }[] };
    assert.equal(list.keys.find((k) => k.id === ci.body.id)!.gateway?.spentUsd, 0);

    // /v1/me tells the CLI the same key may call models, and where.
    const me = (await import("../app/v1/me/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
    const mine = (await (await me.GET(new NextRequest("https://app.example.test/v1/me", { headers: { authorization: `Bearer ${ci.body.key}` } }))).json()) as Json;
    assert.deepEqual(mine.actor.modelAccess, { capUsd: null, dailyUsd: 50, walletUsd: 5 });
    assert.equal(mine.modelsUrl, "https://api.example.test");
    const theirs = (await (await me.GET(new NextRequest("https://app.example.test/v1/me", { headers: { authorization: `Bearer ${admin}` } }))).json()) as Json;
    assert.equal(theirs.actor.modelAccess, null, "a platform key has none");

    // Who may give it, and how it must be asked: refused, nothing made.
    // No limit of its own (28 Nov 2026): the account's billing decides; nothing about money is the key's.
    const bare = await post(admin, { modelAccess: {} });
    assert.equal(bare.status, 200, JSON.stringify(bare.body));
    assert.deepEqual(bare.body.modelAccess, { capUsd: null, dailyUsd: null, walletUsd: null });
    await (await import("../server/auth.ts")).revokeApiKey(tenant, bare.body.id);
    const before = (await listApiKeys(tenant)).length;
    assert.equal((await post(admin, { modelAccess: { dailyUsd: 0.001 } })).status, 400, "a limit that rounds to $0");
    assert.equal((await post(admin, { modelAccess: { dailyUsd: 5, walletUsd: -1 } })).status, 400);
    assert.equal((await post(admin, { modelAccess: { dailyUsd: 5, models: {} } })).status, 400, "nothing else in it");
    assert.equal((await post(admin, { modelAccess: true })).status, 400);
    assert.equal((await post(admin, { purpose: "gateway", capUsd: 5, modelAccess: { dailyUsd: 5 } })).status, 400, "not on a gateway key");
    const { key: scopedAdmin } = await createApiKey(tenant, "scoped admin", undefined, undefined, "admin", ["one"]);
    assert.equal((await post(scopedAdmin, { modelAccess: { dailyUsd: 5 } })).status, 403, "only an admin of every workspace spends the account's balance");
    const { key: editor } = await createApiKey(tenant, "editor", undefined, undefined, "editor");
    assert.equal((await post(editor, { modelAccess: { dailyUsd: 5 } })).status, 403, "keys:manage, as for any key");
    assert.equal((await listApiKeys(tenant)).length, before + 2, "only the two keys this test made by hand");

    // Every other key keeps its reach: a plain API key opens no model route,
    // a gateway key no /v1 route.
    const plain = await gate(admin);
    assert.ok("status" in plain && plain.status === 403 && plain.reason === "no_model_grant");
    const gw = await post(admin, { purpose: "gateway", capUsd: 5 });
    const gwApi = await resolveTenant(new NextRequest("https://app.example.test/v1/workspaces", { headers: { authorization: `Bearer ${gw.body.key}` } }));
    assert.equal(gwApi.tenant, null);

    // A wallet budget changes on the key itself.
    const idRoute = (await import("../app/v1/keys/[id]/route.ts")) as { PATCH: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
    const patched = await idRoute.PATCH(new NextRequest(`https://app.example.test/v1/keys/${ci.body.id}`, { method: "PATCH", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ walletUsd: 7 }) }), { params: Promise.resolve({ id: ci.body.id }) });
    assert.equal(patched.status, 200, await patched.clone().text());
    door.resetGatewayKeyCacheForTests();
    // FOL-268: images and PDFs read into text first — on, seen by the door, refused beside another field, off again.
    const media = (body: unknown) => idRoute.PATCH(new NextRequest(`https://app.example.test/v1/keys/${ci.body.id}`, { method: "PATCH", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ci.body.id }) });
    const on = await media({ mediaToText: true });
    assert.equal(on.status, 200, await on.clone().text());
    assert.deepEqual(await on.json(), { ok: true, id: ci.body.id, mediaToText: true });
    door.resetGatewayKeyCacheForTests();
    const seen = await gate(ci.body.key);
    assert.ok("who" in seen && seen.who.grant.mediaToText === true);
    assert.equal((await media({ mediaToText: true, walletUsd: 1 })).status, 400);
    assert.equal((await media({ mediaToText: "yes" })).status, 400);
    assert.equal((await media({ mediaToText: false })).status, 200);
    door.resetGatewayKeyCacheForTests();

    // Rotation: the same grant and the same chain, so what it spent still counts.
    const { record: next, key: rotated } = await rotateApiKey(tenant, ci.body.id, 0);
    assert.match(rotated, /^fr_api_/);
    assert.equal(next.purpose, undefined);
    assert.deepEqual(next.gateway, { capUsd: null, dailyUsd: 50, credential: "account", walletUsd: 7, principal: ci.body.id });
    const nextGate = await gate(rotated);
    assert.ok("who" in nextGate);
    door.resetGatewayKeyCacheForTests();
    const oldGate = await gate(ci.body.key);
    assert.ok("status" in oldGate && oldGate.status === 401, "the rotated-away key is refused at the gateway");
    const rotatedTwice = await rotateApiKey(tenant, next.id, 0);
    assert.equal(rotatedTwice.record.gateway?.principal, ci.body.id, "the chain's first id, however many rotations");

    // Revocation: both doors refuse it on the next request.
    await revokeApiKey(tenant, rotatedTwice.record.id);
    door.resetGatewayKeyCacheForTests();
    const gone = await gate(rotatedTwice.key);
    assert.ok("status" in gone && gone.status === 401);
    const goneApi = await resolveTenant(new NextRequest("https://app.example.test/v1/workspaces", { headers: { authorization: `Bearer ${rotatedTwice.key}` } }));
    assert.equal(goneApi.tenant, null);

    // Only an admin of every workspace may rotate a key that may call
    // models; a scoped admin who can see it cannot (Codex review).
    const rotRoute = (await import("../app/v1/keys/[id]/rotate/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
    const scopedCi = await createApiKey(tenant, "scoped ci", undefined, undefined, "editor", ["one"], { models: { capUsd: null, dailyUsd: 5, walletUsd: 0 } });
    const r403 = await rotRoute.POST(new NextRequest(`https://app.example.test/v1/keys/${scopedCi.record.id}/rotate`, { method: "POST", headers: { authorization: `Bearer ${scopedAdmin}`, "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: scopedCi.record.id }) });
    assert.equal(r403.status, 403, await r403.clone().text());

    // A maker demoted below "admin of every workspace": every key of theirs
    // that may call models goes, whatever its own role (Codex review).
    const { revokeKeysBeyond } = await import("../server/auth.ts");
    const made = await createApiKey(tenant, "ana's ci", "ana@one.test", undefined, "editor", null, { models: { capUsd: null, dailyUsd: 5, walletUsd: 0 } });
    const plainOfAna = await createApiKey(tenant, "ana's plain", "ana@one.test", undefined, "editor");
    const gone2 = await revokeKeysBeyond(tenant, "ana@one.test", { role: "editor", workspaces: null });
    assert.deepEqual(gone2, [made.record.id], "the model key goes; her editor platform key stays");
    assert.ok(!(await listApiKeys(tenant)).find((k) => k.id === plainOfAna.record.id)!.revokedAt);

    // Expiry: the same, on both route families.
    const short = await createApiKey(tenant, "short", undefined, undefined, "editor", null, { expiresAt: new Date(Date.now() + 60_000), models: { capUsd: null, dailyUsd: 5, walletUsd: 0 } });
    assert.ok("who" in (await gate(short.key)));
    const later = await door.authenticate({ authorization: `Bearer ${short.key}` }, Date.now() + 120_000);
    assert.ok("status" in later && later.status === 401 && later.reason === "key_expired");
  } finally {
    door.setGatewayKeyLookupForTests(null);
    door.setGatewayTouchForTests(null);
  }
});

test("one key at foldrun login: the person's yes gives the sign-in model access, within the login's limits; no yes, or no standing, gives a platform key", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { beginCliLogin, decideCliLogin, pollCliLogin, mayGrantModels } = await import("../server/cli-login.ts");
  const { listApiKeys, CLI_MODEL_GRANT, rotateApiKey } = await import("../server/auth.ts");
  const tenant = `login${Date.now()}`;
  const owner = { tenant, email: `owner@${tenant}.test`, role: "owner" as const, workspaces: null };
  await (await import("./people-fixture.ts")).ensurePeople(tenant, [{ email: `owner@${tenant}.test` }, { email: `ed@${tenant}.test`, role: "editor" }, { email: `ad@${tenant}.test`, role: "admin", workspaces: ["one"] }]);
  const signIn = async (person: typeof owner | { tenant: string; email: string; role: "editor" | "admin"; workspaces: string[] | null }, models?: boolean) => {
    const req = await beginCliLogin("laptop");
    assert.equal(await decideCliLogin(req.code, "approve", person, models === undefined ? {} : { models }), "approved");
    const got = await pollCliLogin(req.id);
    assert.equal(got.status, "approved");
    const keys = await listApiKeys(tenant);
    return keys[keys.length - 1]!;
  };
  assert.equal(mayGrantModels(owner), true);
  assert.equal(mayGrantModels({ role: "editor", workspaces: null }), false);
  assert.equal(mayGrantModels({ role: "admin", workspaces: ["one"] }), false);

  const yes = await signIn(owner, true);
  assert.equal(yes.origin, "cli-login");
  assert.equal(yes.role, "admin", "an owner's sign-in is an admin's, as ever");
  assert.deepEqual(yes.gateway, { ...CLI_MODEL_GRANT, credential: "account", principal: yes.id });
  assert.equal((await signIn(owner)).gateway, undefined, "no word from the page: a platform key, as before");
  assert.equal((await signIn(owner, false)).gateway, undefined, "unticked");
  assert.equal((await signIn({ tenant, email: `ed@${tenant}.test`, role: "editor", workspaces: null }, true)).gateway, undefined, "an editor cannot let a key spend the account's balance");
  assert.equal((await signIn({ tenant, email: `ad@${tenant}.test`, role: "admin", workspaces: ["one"] }, true)).gateway, undefined, "nor a scoped admin");

  // Demoted while approving: read again after the insert, the key with the
  // grant is revoked and the person asked to approve again (Codex review).
  const racing = await beginCliLogin("laptop");
  const before = (await listApiKeys(tenant)).length;
  await assert.rejects(decideCliLogin(racing.code, "approve", owner, { models: true, recheck: async () => ({ role: "editor", workspaces: null }) }), /role or projects changed/);
  const after = await listApiKeys(tenant);
  assert.equal(after.length, before + 1);
  assert.ok(after[after.length - 1]!.revokedAt, "the key made meanwhile is revoked");
  assert.equal((await pollCliLogin(racing.id)).status, "pending", "the request can be approved again");

  // The CLI renews its own key (FOL-71): the grant and its chain go on.
  const renewed = await rotateApiKey(tenant, yes.id, 0, undefined, { keepCliLogin: true });
  assert.equal(renewed.record.origin, "cli-login");
  assert.deepEqual(renewed.record.gateway, { ...CLI_MODEL_GRANT, credential: "account", principal: yes.id });
});

test("the approval page is told the terms; only a signed-in person who may give model access is offered it", opts, async () => {
  const { NextRequest } = await import("next/server");
  const { beginCliLogin } = await import("../server/cli-login.ts");
  const route = (await import("../app/v1/cli/authorize/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>; POST: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const req = await beginCliLogin("laptop");
  const open = (await (await route.GET(new NextRequest(`https://app.example.test/v1/cli/authorize?code=${req.code}`))).json()) as Json;
  assert.deepEqual(open.modelAccess, { offered: false, capUsd: null, dailyUsd: null, walletUsd: null }, "nobody signed in: the terms, not offered");
});

test("one key at submission: a run started with it is queued, and the reusable key is nowhere in what was queued or stored — no row, no file", opts, async () => {
  const { migrate, ormRequired } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey } = await import("../server/auth.ts");
  const tenant = `sub${Date.now()}`;
  const ws = path.join(process.env.FOLDRUN_DATA!, tenant, "workspaces", "desk");
  fs.mkdirSync(path.join(ws, "agents", "coder"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  fs.writeFileSync(path.join(ws, "agents", "coder", "agent.md"), "---\nname: coder\n---\n\nYou code.\n");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows", "nightly.md"), "---\ntrigger: schedule\nschedule: \"0 3 * * *\"\n---\n\n1. [[coder]] — Tidy up.\n");
  const { key } = await createApiKey(tenant, "ci", "ana@one.test", undefined, "editor", null, { models: { capUsd: null, dailyUsd: 5, walletUsd: 0 } });
  const agentRun = (await import("../app/v1/workspaces/[workspace]/agents/[agent]/run/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; agent: string }> }) => Promise<Response> };
  const flowRun = (await import("../app/v1/workspaces/[workspace]/flows/[flow]/run/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; flow: string }> }) => Promise<Response> };
  const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const a = await agentRun.POST(post(`https://app.example.test/v1/workspaces/desk/agents/coder/run`, { task: "add a test" }), { params: Promise.resolve({ workspace: "desk", agent: "coder" }) });
  assert.equal(a.status, 200, await a.clone().text());
  const f = await flowRun.POST(post(`https://app.example.test/v1/workspaces/desk/flows/nightly/run`, {}), { params: Promise.resolve({ workspace: "desk", flow: "nightly" }) });
  assert.equal(f.status, 200, await f.clone().text());

  const secret = key.slice(7); // the part after fr_api_
  // Every row of every table, as text.
  // The driver's own pool: drizzle's sql tag lives in the platform's modules.
  const pool = (ormRequired() as unknown as { $client: { query: (q: string) => Promise<{ rows: Record<string, string>[] }> } }).$client;
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows as { tablename: string }[];
  for (const { tablename } of tables) {
    const rows = (await pool.query(`SELECT row_to_json(zz_row)::text AS j FROM "${tablename}" zz_row`)).rows as { j: string }[];
    for (const r of rows) assert.ok(!r.j.includes(secret), `the key is in ${tablename}`);
  }
  // Every file the platform wrote for the account.
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(process.env.FOLDRUN_DATA!)) assert.ok(!fs.readFileSync(file).includes(secret), `the key is in ${file}`);
});
