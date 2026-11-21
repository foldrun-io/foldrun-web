// L12 + L13: /api/healthz and /api/version tell a stranger only that the
// platform answers (and, for the version, its name and API date). Build shas,
// the release time and the database / Redis / worker flags need a credential:
// an account's key (any role) or a signed-in session, or the scraper's token.
// And a 401 never names a config variable.
//
//   node --import ./tests/register.mjs --test tests/probe-detail.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-probe-"));
const release = path.join(process.env.FOLDRUN_DATA, "release.json");
fs.writeFileSync(
  release,
  JSON.stringify({
    version: "v2026.11.01.3",
    released_at: "2026-11-01T05:00:00Z",
    build: "aaaaaaa.bbbbbbb.ccccccc.ddddddd.eeeeeee",
    components: { core: "aaaaaaa", platform: "bbbbbbb", web: "ccccccc", docs: "ddddddd", infra: "eeeeeee" },
    packages: { core: "1.0.0", cli: "2.0.0" },
  }),
);
process.env.FOLDRUN_RELEASE_FILE = release;
delete process.env.FOLDRUN_VERSION;
delete process.env.FOLDRUN_BUILD;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_METRICS_TOKEN = "scraper-token-for-the-test";

const { NextRequest } = await import("next/server");
const { createApiKey, resolveTenant } = await import("../server/auth.ts");
const { GET: healthz } = await import("../app/api/healthz/route.ts");
const { GET: version } = await import("../app/api/version/route.ts");

const ask = (route: string, bearer?: string) =>
  new NextRequest(`http://localhost/api/${route}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });

test("healthz: a stranger gets ok and nothing else", async () => {
  const res = await healthz(ask("healthz"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("healthz: a wrong or malformed credential is a stranger too, not an error", async () => {
  for (const bearer of ["fr_api_nope", "scraper-token-for-the-tesx", "x"]) {
    const res = await healthz(ask("healthz", bearer));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true }, bearer);
  }
});

test("healthz: any role of an account's key sees the dependency flags", async () => {
  for (const role of ["viewer", "editor", "admin"] as const) {
    const { key } = await createApiKey("acme", role, "me@acme.test", undefined, role);
    const body = (await (await healthz(ask("healthz", key))).json()) as Record<string, unknown>;
    assert.equal(body.ok, true, role);
    assert.equal(body.version, "v2026.11.01.3", role);
    for (const k of ["role", "workerAlive", "database", "redis"]) assert.ok(k in body, `${role} sees ${k}`);
  }
});

test("healthz: the scraper's token sees them too; an A2A key does not", async () => {
  const body = (await (await healthz(ask("healthz", "scraper-token-for-the-test"))).json()) as Record<string, unknown>;
  assert.ok("workerAlive" in body && "database" in body);
  const { key } = await createApiKey("acme", "peer", "me@acme.test", undefined, "viewer", ["ws"], { a2a: { workspace: "ws", flows: ["f"], maxTasks: 1 } });
  assert.deepEqual(await (await healthz(ask("healthz", key))).json(), { ok: true }, "a key that opens no /api route opens no detail");
});

test("version: a stranger gets the name and the API date — no shas, no release time, no packages, no engines", async () => {
  const body = (await (await version(ask("version"))).json()) as Record<string, unknown>;
  // `urls` (21 Nov 2026): the install's public addresses, open on purpose —
  // a CLI asks them before it has a key (tests/version.test.ts).
  assert.deepEqual(Object.keys(body).sort(), ["api", "urls", "version"]);
  assert.equal(body.version, "v2026.11.01.3");
  const text = JSON.stringify(body);
  for (const leak of ["aaaaaaa", "2026-11-01T05", "released_at", "build", "components", "packages", "browsers"]) assert.ok(!text.includes(leak), leak);
});

test("version: a key (any role) or the scraper's token gets everything it had", async () => {
  const { key } = await createApiKey("acme", "viewer", "me@acme.test", undefined, "viewer");
  for (const bearer of [key, "scraper-token-for-the-test"]) {
    const body = (await (await version(ask("version", bearer))).json()) as { released_at: string; build: string; components: { core: string }; packages: { cli: string }; api: string };
    assert.equal(body.released_at, "2026-11-01T05:00:00Z");
    assert.equal(body.build, "aaaaaaa.bbbbbbb.ccccccc.ddddddd.eeeeeee");
    assert.equal(body.components.core, "aaaaaaa");
    assert.equal(body.packages.cli, "2.0.0");
    assert.ok(body.api);
  }
});

test("L13: the 401 for a request with no credential does not name FOLDRUN_DEV_NO_AUTH or any variable", async () => {
  const r = await resolveTenant(new NextRequest("http://localhost/api/workspaces"));
  assert.equal(r.tenant, null);
  const message = (r as { message: string }).message;
  assert.match(message, /missing API key/);
  assert.doesNotMatch(message, /FOLDRUN_|x-foldrun-tenant|NO_AUTH/i);
});
